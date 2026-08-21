use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Protocol {
    OpenAIResponses,
    OpenAIChat,
    AnthropicMessages,
}
