use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
}

#[allow(dead_code)]
pub trait Tool: Send + Sync {
    fn metadata(&self) -> &ToolMetadata;
    fn initialize(&mut self) -> Result<(), Box<dyn std::error::Error>>;
    fn shutdown(&mut self) -> Result<(), Box<dyn std::error::Error>>;
}

#[allow(dead_code)]
pub struct PluginManager {
    tools: Vec<Box<dyn Tool>>,
}

#[allow(dead_code)]
impl PluginManager {
    pub fn new() -> Self {
        Self {
            tools: Vec::new(),
        }
    }

    pub fn register_tool(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    pub fn get_tool(&self, id: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.metadata().id == id).map(|t| t.as_ref())
    }
}

impl Default for PluginManager {
    fn default() -> Self {
        Self::new()
    }
}
