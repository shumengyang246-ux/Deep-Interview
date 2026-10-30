use crate::credentials;
use crate::memory::{self, Memory};
use crate::settings::{AssistantConfig, Thinking};
use crate::web_search;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::{ipc::Channel, Manager, State};
use tokio_util::sync::CancellationToken;

pub const MODEL: &str = "deepseek-flash";
pub(crate) const ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
#[derive(Default)]
pub struct ChatState(pub Mutex<Option<(String, CancellationToken)>>);
#[derive(Clone, Deserialize, Serialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}
enum StreamPiece {
    Content(String),
    Thinking,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub request_id: String,
    pub kind: String,
    pub text: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    has_key: bool,
    model: &'static str,
    endpoint: &'static str,
}
#[tauri::command]
pub fn model_status() -> Result<ModelStatus, String> {
    Ok(ModelStatus {
        has_key: credentials::read()?.is_some(),
        model: MODEL,
        endpoint: ENDPOINT,
    })
}
#[tauri::command]
pub fn save_api_key(key: String) -> Result<(), String> {
    credentials::save(&key)
}
#[tauri::command]
pub fn delete_api_key() -> Result<(), String> {
    credentials::delete()
}
#[tauri::command]
pub fn cancel_chat(request_id: String, state: State<ChatState>) -> Result<(), String> {
    let active = state.0.lock().map_err(|_| "请求状态异常")?;
    if let Some((id, token)) = active.as_ref() {
        if id == &request_id {
            token.cancel();
        }
    }
    Ok(())
}
#[tauri::command]
pub fn start_chat(
    app: tauri::AppHandle,
    request_id: String,
    messages: Vec<Message>,
    prior_memory: Option<Memory>,
    on_event: Channel<StreamEvent>,
    state: State<ChatState>,
    config: State<AssistantConfig>,
) -> Result<(), String> {
    memory::validate(&messages)?;
    if request_id.is_empty() || request_id.len() > 80 {
        return Err("请求标识无效。".into());
    }
    let key = credentials::read()?.ok_or("请先在设置中保存 DeepSeek API Key。")?;
    // Snapshot configuration once per request; reread the prompt file on every new turn.
    let (thinking, system_prompt, web_search) = config.snapshot()?;
    let token = CancellationToken::new();
    {
        let mut active = state.0.lock().map_err(|_| "请求状态异常")?;
        if active.is_some() {
            return Err("上一条回答仍在生成，请先停止。".into());
        }
        *active = Some((request_id.clone(), token.clone()));
    }
    tauri::async_runtime::spawn(async move {
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => Ok("cancelled".to_string()),
            result = run_chat(&key, &messages, prior_memory, thinking, &system_prompt, web_search, |kind, text| {
                on_event.send(StreamEvent { request_id: request_id.clone(), kind: kind.into(), text }).map_err(|_| "窗口已断开，回答已停止。".to_string())
            }) => result,
        };
        // Clear ownership before sending the terminal event so a new request can start.
        if let Ok(mut active) = app.state::<ChatState>().0.lock() {
            if active.as_ref().is_some_and(|(id, _)| id == &request_id) {
                *active = None;
            }
        }
        let (kind, text) = match result {
            Ok(reason) if reason == "cancelled" => ("cancelled", "已停止生成".into()),
            Ok(reason) if reason == "length" => (
                "done",
                "已达到本次输出上限（包括思考），可继续追问或降低思考程度。".into(),
            ),
            Ok(_) => ("done", String::new()),
            Err(e) => ("error", e),
        };
        let _ = on_event.send(StreamEvent {
            request_id,
            kind: kind.into(),
            text,
        });
    });
    Ok(())
}

async fn summarize(key: &str, input: String) -> Result<String, String> {
    let mut output = String::new();
    let reason = tokio::time::timeout(
        Duration::from_secs(120),
        stream(
            key,
            &[Message {
                role: "user".into(),
                content: input,
            }],
            Thinking::Off,
            memory::SUMMARY_PROMPT,
            2800,
            |piece| {
                if let StreamPiece::Content(text) = piece {
                    output.push_str(&text);
                    if output.len() > memory::SUMMARY_BYTES {
                        return Err("摘要超过大小限制。".into());
                    }
                }
                Ok(())
            },
        ),
    )
    .await
    .map_err(|_| "摘要生成超时。")??;
    if reason != "stop" {
        return Err("摘要未完整生成，请重试。".into());
    }
    Ok(output)
}
async fn run_chat(
    key: &str,
    messages: &[Message],
    prior: Option<Memory>,
    thinking: Thinking,
    system_prompt: &str,
    web_search_enabled: bool,
    emit: impl Fn(&str, String) -> Result<(), String>,
) -> Result<String, String> {
    let system_prompt = if web_search_enabled {
        format!(
            "{system_prompt}\n\n{}\n{}",
            web_search::ANSWER_PROMPT,
            web_search::time_context()
        )
    } else {
        system_prompt.to_string()
    };
    let mut context = tokio::time::timeout(
        Duration::from_secs(600),
        memory::prepare(
            messages,
            prior,
            system_prompt.len()
                + if web_search_enabled {
                    web_search::CONTEXT_RESERVE
                } else {
                    0
                },
            thinking.max_tokens() as usize,
            |input| {
                let emit = &emit;
                async move {
                    emit("compacting", "正在整理会话记忆…".into())?;
                    summarize(key, input).await
                }
            },
            |memory| {
                emit(
                    "memory",
                    serde_json::to_string(&memory).map_err(|_| "无法保存会话记忆。")?,
                )
            },
        ),
    )
    .await
    .map_err(|_| "上下文压缩超时，已保留原文与完成的摘要，可重试继续。")??;
    if web_search_enabled {
        emit("answering", String::new())?;
        let research = web_search::research(key, &context, &emit).await?;
        research.augment(&mut context);
    }
    emit("answering", String::new())?;
    tokio::time::timeout(
        Duration::from_secs(thinking.timeout_seconds()),
        stream(
            key,
            &context,
            thinking,
            &system_prompt,
            thinking.max_tokens(),
            |piece| match piece {
                StreamPiece::Content(text) => emit("delta", text),
                StreamPiece::Thinking => emit("thinking", String::new()),
            },
        ),
    )
    .await
    .map_err(|_| "回答超时，已保留收到的内容，可手动重试。".to_string())?
}

// Buffer bytes, not strings: UTF-8 code points and SSE lines can cross network chunks.
#[derive(Default)]
struct SseDecoder {
    pending: Vec<u8>,
    data: Vec<String>,
}
impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.pending.extend_from_slice(bytes);
        if self.pending.len() > 2_000_000 {
            return Err("服务端流式事件过大。".into());
        }
        let mut events = Vec::new();
        while let Some(pos) = self.pending.iter().position(|&c| c == b'\n') {
            let line: Vec<_> = self.pending.drain(..=pos).collect();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "服务端返回无效编码。")?
                .trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !self.data.is_empty() {
                    events.push(self.data.join("\n"));
                    self.data.clear();
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data
                    .push(data.strip_prefix(' ').unwrap_or(data).to_string());
                if self.data.iter().map(String::len).sum::<usize>() > 2_000_000 {
                    return Err("服务端流式事件过大。".into());
                }
            }
        }
        Ok(events)
    }
}
pub(crate) fn http_error(code: u16) -> String {
    let message = match code {
        401 => "API Key 无效或已撤销，请在设置中更换。",
        402 => "DeepSeek 账户余额不足，请在官网检查余额。",
        403 => "该 Key 暂无访问权限，请检查官网账户。",
        429 => "请求过于频繁或账户受限，请稍后重试。",
        400 | 404 | 422 => "请求或模型不可用，请核对 DeepSeek 官方服务状态。",
        500..=599 => "DeepSeek 服务暂时异常，请稍后重试。",
        _ => "DeepSeek 请求失败，请稍后重试。",
    };
    format!("{message}（HTTP {code}）")
}
fn request_body(
    messages: &[Message],
    thinking: Thinking,
    system_prompt: &str,
    max_tokens: u32,
) -> serde_json::Value {
    let mut combined = Vec::new();
    if !system_prompt.trim().is_empty() {
        combined.push(Message {
            role: "system".into(),
            content: system_prompt.to_string(),
        });
    }
    combined.extend_from_slice(messages);
    let mut body = serde_json::json!({ "model": MODEL, "messages": combined, "stream": true, "max_tokens": max_tokens });
    thinking.apply(&mut body);
    body
}
async fn stream(
    key: &str,
    messages: &[Message],
    thinking: Thinking,
    system_prompt: &str,
    max_tokens: u32,
    emit: impl FnMut(StreamPiece) -> Result<(), String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化网络连接。")?;
    let response = tokio::time::timeout(
        Duration::from_secs(60),
        client
            .post(ENDPOINT)
            .bearer_auth(key)
            .json(&request_body(messages, thinking, system_prompt, max_tokens))
            .send(),
    )
    .await
    .map_err(|_| "等待 DeepSeek 响应超时，请稍后重试。")?
    .map_err(|_| "无法连接 DeepSeek，请检查网络。")?;
    if !response.status().is_success() {
        return Err(http_error(response.status().as_u16()));
    }
    consume(response.bytes_stream(), emit).await
}
async fn consume<S, E>(
    mut chunks: S,
    mut emit: impl FnMut(StreamPiece) -> Result<(), String>,
) -> Result<String, String>
where
    S: futures_util::Stream<Item = Result<bytes::Bytes, E>> + Unpin,
{
    let mut decoder = SseDecoder::default();
    let mut finish = None;
    let mut has_content = false;
    let mut has_reasoning = false;
    loop {
        let chunk = tokio::time::timeout(Duration::from_secs(120), chunks.next())
            .await
            .map_err(|_| "流式响应超过 120 秒无数据，已停止。")?;
        let Some(chunk) = chunk else {
            return Err("连接提前结束，回答可能不完整。请手动重试。".into());
        };
        for data in decoder.push(&chunk.map_err(|_| "网络中断，已保留收到的内容。")?)?
        {
            if data.trim() == "[DONE]" {
                let reason = finish.ok_or("响应缺少结束原因，回答可能不完整。")?;
                if !has_content {
                    if has_reasoning {
                        return Err("模型进行了思考但未返回正文，可能已耗尽输出预算；请降低思考程度后重试。".into());
                    }
                    return Err("模型未返回回答内容，请重试。".into());
                }
                return Ok(reason);
            }
            let value: serde_json::Value =
                serde_json::from_str(&data).map_err(|_| "无法解析 DeepSeek 流式响应。")?;
            if value.get("error").is_some() {
                return Err("DeepSeek 在生成过程中返回错误，请稍后重试。".into());
            }
            if !has_reasoning
                && value["choices"][0]["delta"]["reasoning_content"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
            {
                has_reasoning = true;
                // Signal progress without storing or exposing raw reasoning text.
                emit(StreamPiece::Thinking)?;
            }
            if let Some(text) = value["choices"][0]["delta"]["content"].as_str() {
                if !text.is_empty() {
                    has_content = true;
                    emit(StreamPiece::Content(text.to_string()))?;
                }
            }
            if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
                if !matches!(reason, "stop" | "length") {
                    return Err("模型未正常完成回答，请重试或调整问题。".into());
                }
                finish = Some(reason.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Billable official model and Search APIs; synthetic question only"]
    async fn live_web_search_answer() {
        use std::cell::RefCell;
        let key = credentials::read().unwrap().expect("Save an API key first");
        let answer = RefCell::new(String::new());
        let sources = RefCell::new(Vec::<web_search::Source>::new());
        let queries = RefCell::new(0usize);
        let thinking_received = RefCell::new(false);
        let result = run_chat(&key, &[Message {
            role: "user".into(),
            content: "请联网检索 Rust 官方文档，概括所有权（ownership）的作用，回答不超过80字并标注来源编号。".into(),
        }], None, Thinking::Low, "你是一个中文技术助手，请根据实际搜索资料简洁回答。", true,
        |kind, text| {
            match kind {
                "delta" => answer.borrow_mut().push_str(&text),
                "thinking" => *thinking_received.borrow_mut() = true,
                "sources" => *sources.borrow_mut() = serde_json::from_str(&text).unwrap(),
                "search_status" if text.starts_with("正在搜索：") => *queries.borrow_mut() += 1,
                _ => {},
            }
            Ok(())
        }).await;
        let cited_sources: Vec<usize> = sources
            .borrow()
            .iter()
            .filter(|source| answer.borrow().contains(&format!("[{}]", source.id)))
            .map(|source| source.id)
            .collect();
        let passed = result.as_deref() == Ok("stop") && !cited_sources.is_empty();
        std::fs::create_dir_all("../artifacts/local").unwrap();
        std::fs::write("../artifacts/local/web-search-live.json", serde_json::to_vec_pretty(&serde_json::json!({
            "passed":passed,"syntheticQuestion":true,"searchCalls":*queries.borrow(),
            "sourceCount":sources.borrow().len(),"sourceUrls":sources.borrow().iter().map(|s| &s.url).collect::<Vec<_>>(),
            "answerCharacters":answer.borrow().chars().count(),"citationReceived":!cited_sources.is_empty(),
            "citedSourceIds":cited_sources,
            "thinkingProgressReceived":*thinking_received.borrow(),"result":result
        })).unwrap()).unwrap();
        assert!(
            passed,
            "Live search failed; see artifacts/local/web-search-live.json"
        );
    }
    #[tokio::test]
    #[ignore = "Two billable official API calls; synthetic context and smaller test budget"]
    async fn live_context_memory() {
        let key = credentials::read().unwrap().expect("Save an API key first");
        let messages=vec![Message{role:"user".into(),content:format!("用户明确事实：项目代号是 JADE_BAMBOO_427。约束：不使用云同步。下面是无关重复占位文本，可省略：{}", "背景占位。".repeat(900))}, Message{role:"assistant".into(),content:"我记住了项目代号和不使用云同步的约束。".into()}, Message{role:"user".into(),content:"我们项目的代号是什么？只输出代号。".into()}];
        let mut checkpoint = None;
        // Force the production compressor to trigger with a small synthetic history.
        let context = memory::prepare(
            &messages,
            None,
            105000,
            4096,
            |input| summarize(&key, input),
            |m| {
                checkpoint = m;
                Ok(())
            },
        )
        .await
        .unwrap();
        let mut answer = String::new();
        let result = stream(
            &key,
            &context,
            Thinking::Off,
            "根据历史记忆和当前问题回答。",
            128,
            |piece| {
                if let StreamPiece::Content(text) = piece {
                    answer.push_str(&text);
                }
                Ok(())
            },
        )
        .await;
        let summary_preserved = checkpoint
            .as_ref()
            .is_some_and(|m| m.summary.contains("JADE_BAMBOO_427") && m.summary.contains("云同步"));
        let passed = result.is_ok() && summary_preserved && answer.trim() == "JADE_BAMBOO_427";
        std::fs::create_dir_all("../artifacts/local").unwrap();
        std::fs::write("../artifacts/local/context-memory-live.json",serde_json::to_vec_pretty(&serde_json::json!({"passed":passed,"syntheticHistory":true,"forcedSmallBudget":true,"summaryPreservedFactAndConstraint":summary_preserved,"answerRecoveredOldFact":answer.trim()=="JADE_BAMBOO_427","checkpointCreated":checkpoint.is_some(),"result":result})).unwrap()).unwrap();
        assert!(passed, "Memory live check failed; see sanitized report");
    }
    #[test]
    fn sse_handles_every_utf8_byte_boundary_crlf_comments_and_multiple_events() {
        let source = ": keepalive\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"你好🌱\"}}]}\r\n\r\ndata: [DONE]\n\n";
        let mut decoder = SseDecoder::default();
        let mut result = Vec::new();
        for b in source.as_bytes() {
            result.extend(decoder.push(&[*b]).unwrap());
        }
        assert_eq!(result.len(), 2);
        assert!(result[0].contains("你好🌱"));
        assert_eq!(result[1], "[DONE]");
    }
    #[tokio::test]
    async fn rejects_truncated_stream_and_preserves_deltas() {
        let chunks = futures_util::stream::iter(vec![Ok::<_, ()>(bytes::Bytes::from_static(
            b"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n",
        ))]);
        let mut output = String::new();
        assert!(consume(chunks, |s| {
            if let StreamPiece::Content(text) = s {
                output.push_str(&text);
            }
            Ok(())
        })
        .await
        .is_err());
        assert_eq!(output, "hello");
    }
    #[tokio::test]
    async fn handles_done_usage_and_length() {
        let chunks = futures_util::stream::iter(vec![Ok::<_, ()>(bytes::Bytes::from_static(b"data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"},\"finish_reason\":\"length\"}]}\n\ndata: {\"choices\":[],\"usage\":{}}\n\ndata: [DONE]\n\n"))]);
        assert_eq!(consume(chunks, |_| Ok(())).await.unwrap(), "length");
    }
    #[tokio::test]
    async fn cancellation_drops_pending_read() {
        let token = CancellationToken::new();
        token.cancel();
        let pending = futures_util::stream::pending::<Result<bytes::Bytes, ()>>();
        tokio::select! { biased; _ = token.cancelled() => {}, _ = consume(pending, |_| Ok(())) => panic!("should cancel") }
    }
    #[tokio::test]
    #[ignore = "One billable official API request; reads local Credential Manager"]
    async fn live_deepseek_stream() {
        let key = credentials::read().unwrap().expect("Save an API key first");
        let mut deltas = 0;
        let mut chars = 0;
        let result = stream(
            &key,
            &[Message {
                role: "user".into(),
                content: "请用一句中文介绍你能如何帮助我整理工作思路。".into(),
            }],
            Thinking::Off,
            "",
            128,
            |s| {
                if let StreamPiece::Content(text) = s {
                    deltas += 1;
                    chars += text.chars().count();
                }
                Ok(())
            },
        )
        .await;
        std::fs::create_dir_all("../artifacts/local").unwrap();
        std::fs::write("../artifacts/local/deepseek-live-test.json", serde_json::to_vec_pretty(&serde_json::json!({"passed":result.is_ok(),"model":MODEL,"endpoint":ENDPOINT,"deltas":deltas,"characters":chars,"result":result})).unwrap()).unwrap();
        assert!(result.is_ok(), "{}", result.unwrap_err());
        assert!(deltas > 1 && chars > 0);
    }
    #[test]
    fn all_thinking_modes_and_system_message_order_match_official_api() {
        let history = vec![
            Message {
                role: "user".into(),
                content: "前一个问题".into(),
            },
            Message {
                role: "assistant".into(),
                content: "前一个回答".into(),
            },
            Message {
                role: "user".into(),
                content: "现在的问题".into(),
            },
        ];
        for (mode, effort) in [
            (Thinking::Off, None),
            (Thinking::Low, Some("low")),
            (Thinking::High, Some("high")),
            (Thinking::Max, Some("max")),
        ] {
            let body = request_body(&history, mode, "我的独立系统指令", mode.max_tokens());
            assert_eq!(body["messages"][0]["role"], "system");
            assert_eq!(body["messages"][0]["content"], "我的独立系统指令");
            assert_eq!(body["messages"][3]["content"], "现在的问题");
            assert_eq!(body["reasoning_effort"].as_str(), effort);
            assert_eq!(
                body["thinking"]["type"],
                if mode == Thinking::Off {
                    "disabled"
                } else {
                    "enabled"
                }
            );
        }
        assert_eq!(
            request_body(&history, Thinking::Off, "  ", 128)["messages"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(serde_json::from_str::<Thinking>("\"invalid\"").is_err());
    }
    #[tokio::test]
    async fn reasoning_only_chunks_emit_progress_without_leaking_into_answer() {
        let data = b"data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"private reasoning\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"reasoning_content\":\"more\",\"content\":\"answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        let chunks = futures_util::stream::iter(vec![Ok::<_, ()>(bytes::Bytes::from_static(data))]);
        let mut progress = 0;
        let mut answer = String::new();
        consume(chunks, |s| {
            match s {
                StreamPiece::Thinking => progress += 1,
                StreamPiece::Content(text) => answer.push_str(&text),
            };
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(progress, 1);
        assert_eq!(answer, "answer");
    }
    #[tokio::test]
    #[ignore = "One billable official API call for system prompt and thinking"]
    async fn live_thinking_system_prompt() {
        let key = credentials::read().unwrap().expect("Save an API key first");
        let mut answer = String::new();
        let mut thinking = false;
        let result = stream(
            &key,
            &[Message {
                role: "user".into(),
                content: "你好".into(),
            }],
            Thinking::Low,
            "这是一项接口验证。无论用户说什么，你的最终回答都必须只包含：SYSTEM_PROMPT_OK",
            2048,
            |piece| {
                match piece {
                    StreamPiece::Thinking => thinking = true,
                    StreamPiece::Content(text) => answer.push_str(&text),
                };
                Ok(())
            },
        )
        .await;
        let passed = result.is_ok() && answer.trim() == "SYSTEM_PROMPT_OK" && thinking;
        std::fs::create_dir_all("../artifacts/local").unwrap();
        std::fs::write("../artifacts/local/thinking-system-test.json", serde_json::to_vec_pretty(&serde_json::json!({"passed":passed,"thinking":"low","thinkingProgressReceived":thinking,"systemPromptFollowed":answer.trim()=="SYSTEM_PROMPT_OK","result":result})).unwrap()).unwrap();
        assert!(
            passed,
            "Thinking/system prompt live check failed; see sanitized report"
        );
    }
}
