use crate::core::database::Database;
use serde::{Deserialize, Serialize};
use tauri::command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_registrar_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_note_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFolder {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersion {
    pub id: String,
    pub note_id: String,
    pub title: String,
    pub content: String,
    pub version_number: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTemplate {
    pub id: String,
    pub name: String,
    pub title_template: String,
    pub content_template: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn create_note(
    title: String,
    content: String,
    tags: Vec<String>,
    linked_registrar_id: Option<String>,
    linked_agent_id: Option<String>,
    category: Option<String>,
    is_pinned: Option<bool>,
    linked_note_ids: Option<Vec<String>>,
    folder_id: Option<String>,
    template_id: Option<String>,
) -> Result<String, String> {
    let note_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let note = Note {
        id: note_id.clone(),
        title,
        content,
        tags,
        linked_registrar_id,
        linked_agent_id,
        category,
        is_pinned,
        linked_note_ids,
        folder_id,
        version: Some(1),
        template_id,
        created_at: now.clone(),
        updated_at: now,
    };

    Database::save_note(&note)
        .map_err(|e| format!("Failed to save note: {}", e))?;

    let _ = crate::core::audit::AuditWriter::write_entry(
        "notes", "create_note", "user", Some(&note_id), Some(&note.title),
    );

    Ok(note_id)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn update_note(
    id: String,
    title: String,
    content: String,
    tags: Vec<String>,
    category: Option<String>,
    is_pinned: Option<bool>,
    linked_note_ids: Option<Vec<String>>,
    folder_id: Option<String>,
    linked_registrar_id: Option<String>,
    linked_agent_id: Option<String>,
) -> Result<(), String> {
    // Create version before updating
    let existing_note = Database::load_note(&id)
        .map_err(|e| format!("Failed to load note: {}", e))?;
    
    // Save version
    let version_id = Uuid::new_v4().to_string();
    let version = crate::core::database::NoteVersion {
        id: version_id,
        note_id: id.clone(),
        title: existing_note.title.clone(),
        content: existing_note.content.clone(),
        version_number: existing_note.version.unwrap_or(1),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    Database::save_note_version(&version)
        .map_err(|e| format!("Failed to save version: {}", e))?;

    // Load existing note to preserve created_at
    let mut note = existing_note;

    note.title = title;
    note.content = content;
    note.tags = tags;
    note.category = category;
    note.is_pinned = is_pinned;
    note.linked_note_ids = linked_note_ids;
    note.folder_id = folder_id;
    note.linked_registrar_id = linked_registrar_id;
    note.linked_agent_id = linked_agent_id;
    note.updated_at = chrono::Utc::now().to_rfc3339();

    Database::save_note(&note)
        .map_err(|e| format!("Failed to update note: {}", e))?;

    let _ = crate::core::audit::AuditWriter::write_entry(
        "notes", "update_note", "user", Some(&id), Some(&note.title),
    );

    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn delete_note(id: String) -> Result<(), String> {
    Database::soft_delete_note(&id)
        .map_err(|e| format!("Failed to delete note: {}", e))?;
    let _ = crate::core::audit::AuditWriter::write_entry(
        "notes", "delete_note", "user", Some(&id), None,
    );
    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_note(id: String) -> Result<Note, String> {
    Database::load_note(&id)
        .map_err(|e| format!("Failed to load note: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_notes(
    linked_registrar_id: Option<String>,
    tags: Option<Vec<String>>,
    linked_agent_id: Option<String>,
) -> Result<Vec<Note>, String> {
    let tag_slice = tags.as_deref();
    Database::load_notes(linked_registrar_id.as_deref(), tag_slice, linked_agent_id.as_deref())
        .map_err(|e| format!("Failed to load notes: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_all_notes() -> Result<Vec<Note>, String> {
    Database::load_notes(None, None, None)
        .map_err(|e| format!("Failed to load notes: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn search_notes(query: String) -> Result<Vec<Note>, String> {
    if query.is_empty() {
        return Database::load_notes(None, None, None)
            .map_err(|e| format!("Failed to load notes: {}", e));
    }
    Database::search_notes(&query)
        .map_err(|e| format!("Failed to search notes: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_all_tags() -> Result<Vec<String>, String> {
    Database::get_all_tags()
        .map_err(|e| format!("Failed to get tags: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_all_categories() -> Result<Vec<String>, String> {
    Database::get_all_categories()
        .map_err(|e| format!("Failed to get categories: {}", e))
}

// Folder commands
#[command]
#[tracing::instrument(skip_all)]
pub fn create_note_folder(
    name: String,
    parent_id: Option<String>,
) -> Result<String, String> {
    let folder_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    
    // Build path
    let path = if let Some(parent) = &parent_id {
        let parent_folder = Database::load_note_folder(parent)
            .map_err(|e| format!("Failed to load parent folder: {}", e))?;
        format!("{}/{}", parent_folder.path, folder_id)
    } else {
        format!("/{}", folder_id)
    };

    let folder = crate::core::database::NoteFolder {
        id: folder_id.clone(),
        name,
        parent_id,
        path,
        created_at: now.clone(),
        updated_at: now,
    };

    Database::save_note_folder(&folder)
        .map_err(|e| format!("Failed to save folder: {}", e))?;

    Ok(folder_id)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn update_note_folder(
    id: String,
    name: Option<String>,
    parent_id: Option<String>,
) -> Result<(), String> {
    let mut folder = Database::load_note_folder(&id)
        .map_err(|e| format!("Failed to load folder: {}", e))?;

    if let Some(new_name) = name {
        folder.name = new_name;
    }

    if let Some(new_parent_id) = parent_id {
        folder.parent_id = Some(new_parent_id.clone());
        // Rebuild path
        if new_parent_id.is_empty() {
            folder.path = format!("/{}", folder.id);
        } else {
            let parent_folder = Database::load_note_folder(&new_parent_id)
                .map_err(|e| format!("Failed to load parent folder: {}", e))?;
            folder.path = format!("{}/{}", parent_folder.path, folder.id);
        }
    }

    folder.updated_at = chrono::Utc::now().to_rfc3339();

    Database::save_note_folder(&folder)
        .map_err(|e| format!("Failed to update folder: {}", e))?;

    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn delete_note_folder(id: String) -> Result<(), String> {
    Database::delete_note_folder(&id)
        .map_err(|e| format!("Failed to delete folder: {}", e))?;
    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_note_folders() -> Result<Vec<NoteFolder>, String> {
    let db_folders = Database::load_note_folders()
        .map_err(|e| format!("Failed to load folders: {}", e))?;
    
    Ok(db_folders.into_iter().map(|f| NoteFolder {
        id: f.id,
        name: f.name,
        parent_id: f.parent_id,
        path: f.path,
        created_at: f.created_at,
        updated_at: f.updated_at,
    }).collect())
}

// Version commands
#[command]
#[tracing::instrument(skip_all)]
pub fn create_note_version(
    note_id: String,
    title: String,
    content: String,
    version_number: i32,
) -> Result<String, String> {
    let version_id = Uuid::new_v4().to_string();
    let version = crate::core::database::NoteVersion {
        id: version_id.clone(),
        note_id,
        title,
        content,
        version_number,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    Database::save_note_version(&version)
        .map_err(|e| format!("Failed to save version: {}", e))?;

    Ok(version_id)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_note_versions(note_id: String) -> Result<Vec<NoteVersion>, String> {
    let db_versions = Database::load_note_versions(&note_id)
        .map_err(|e| format!("Failed to load versions: {}", e))?;
    
    Ok(db_versions.into_iter().map(|v| NoteVersion {
        id: v.id,
        note_id: v.note_id,
        title: v.title,
        content: v.content,
        version_number: v.version_number,
        created_at: v.created_at,
    }).collect())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_note_version(version_id: String) -> Result<NoteVersion, String> {
    let version = Database::get_note_version(&version_id)
        .map_err(|e| format!("Failed to load version: {}", e))?;
    
    Ok(NoteVersion {
        id: version.id,
        note_id: version.note_id,
        title: version.title,
        content: version.content,
        version_number: version.version_number,
        created_at: version.created_at,
    })
}

#[command]
#[tracing::instrument(skip_all)]
pub fn restore_note_version(version_id: String) -> Result<(), String> {
    let version = Database::get_note_version(&version_id)
        .map_err(|e| format!("Failed to load version: {}", e))?;
    
    let note = Database::load_note(&version.note_id)
        .map_err(|e| format!("Failed to load note: {}", e))?;

    // Snapshot current state before restoring so the user can undo
    let snapshot = crate::core::database::NoteVersion {
        id: Uuid::new_v4().to_string(),
        note_id: note.id.clone(),
        title: note.title.clone(),
        content: note.content.clone(),
        version_number: note.version.unwrap_or(1),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    Database::save_note_version(&snapshot)
        .map_err(|e| format!("Failed to snapshot pre-restore state: {}", e))?;

    let mut restored = note;
    restored.title = version.title;
    restored.content = version.content;
    restored.updated_at = chrono::Utc::now().to_rfc3339();

    Database::save_note(&restored)
        .map_err(|e| format!("Failed to restore note: {}", e))?;

    Ok(())
}

// Template commands
#[command]
#[tracing::instrument(skip_all)]
pub fn create_note_template(
    name: String,
    title_template: String,
    content_template: String,
    category: Option<String>,
    tags: Vec<String>,
) -> Result<String, String> {
    let template_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let template = crate::core::database::NoteTemplate {
        id: template_id.clone(),
        name,
        title_template,
        content_template,
        category,
        tags,
        created_at: now.clone(),
        updated_at: now,
    };

    Database::save_note_template(&template)
        .map_err(|e| format!("Failed to save template: {}", e))?;

    Ok(template_id)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_note_templates() -> Result<Vec<NoteTemplate>, String> {
    let db_templates = Database::load_note_templates()
        .map_err(|e| format!("Failed to load templates: {}", e))?;
    
    Ok(db_templates.into_iter().map(|t| NoteTemplate {
        id: t.id,
        name: t.name,
        title_template: t.title_template,
        content_template: t.content_template,
        category: t.category,
        tags: t.tags,
        created_at: t.created_at,
        updated_at: t.updated_at,
    }).collect())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn delete_note_template(id: String) -> Result<(), String> {
    Database::delete_note_template(&id)
        .map_err(|e| format!("Failed to delete template: {}", e))?;
    Ok(())
}

// Advanced search
#[command]
#[tracing::instrument(skip_all)]
pub fn search_notes_advanced(
    query: String,
    folder_id: Option<String>,
    tags: Option<Vec<String>>,
    category: Option<String>,
    linked_registrar_id: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<Vec<Note>, String> {
    // Start with all notes or search results
    let mut notes = if !query.is_empty() {
        Database::search_notes(&query)
            .map_err(|e| format!("Failed to search notes: {}", e))?
    } else {
        Database::load_notes(linked_registrar_id.as_deref(), None, None)
            .map_err(|e| format!("Failed to load notes: {}", e))?
    };
    
    // Apply filters
    if let Some(folder) = &folder_id {
        notes.retain(|n| n.folder_id.as_ref() == Some(folder));
    }
    if let Some(cat) = &category {
        notes.retain(|n| n.category.as_ref() == Some(cat));
    }
    if let Some(reg_id) = &linked_registrar_id {
        notes.retain(|n| n.linked_registrar_id.as_ref() == Some(reg_id));
    }
    if let Some(tag_list) = &tags {
        if !tag_list.is_empty() {
            notes.retain(|n| tag_list.iter().any(|tag| n.tags.contains(tag)));
        }
    }
    if let Some(from) = &date_from {
        notes.retain(|n| n.updated_at >= *from);
    }
    if let Some(to) = &date_to {
        notes.retain(|n| n.updated_at <= *to);
    }
    
    Ok(notes)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn permanently_delete_note(id: String) -> Result<(), String> {
    Database::permanently_delete_note(&id)
        .map_err(|e| format!("Failed to permanently delete note: {}", e))?;
    let _ = crate::core::audit::AuditWriter::write_entry(
        "notes", "permanently_delete_note", "user", Some(&id), None,
    );
    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn restore_note(id: String) -> Result<(), String> {
    Database::restore_note(&id)
        .map_err(|e| format!("Failed to restore note: {}", e))?;
    let _ = crate::core::audit::AuditWriter::write_entry(
        "notes", "restore_note", "user", Some(&id), None,
    );
    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_deleted_notes() -> Result<Vec<Note>, String> {
    Database::load_deleted_notes()
        .map_err(|e| format!("Failed to load deleted notes: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn empty_trash() -> Result<i32, String> {
    let count = Database::empty_trash()
        .map_err(|e| format!("Failed to empty trash: {}", e))?;
    let _ = crate::core::audit::AuditWriter::write_entry(
        "notes", "empty_trash", "user", None, Some(&format!("{} notes", count)),
    );
    Ok(count)
}

// AI suggestions (placeholder - would integrate with AI service)
#[command]
#[tracing::instrument(skip_all)]
pub fn get_note_ai_suggestions(
    note_id: String,
) -> Result<serde_json::Value, String> {
    let note = Database::load_note(&note_id)
        .map_err(|e| format!("Failed to load note: {}", e))?;

    // Basic AI suggestions based on content analysis
    let mut suggestions: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();

    // Suggest tags based on content keywords
    let content_lower = note.content.to_lowercase();
    let title_lower = note.title.to_lowercase();
    let all_text = format!("{} {}", title_lower, content_lower);
    
    let suggested_tags: Vec<String> = vec!["important", "todo", "meeting", "bug", "feature"]
        .iter()
        .filter(|tag| all_text.contains(*tag))
        .map(|s| s.to_string())
        .collect();

    suggestions.insert("suggested_tags".to_string(), serde_json::json!(suggested_tags));

    // Suggest category based on content
    let suggested_category = if all_text.contains("registrar") || all_text.contains("sip") {
        Some("SIP Configuration".to_string())
    } else if all_text.contains("test") || all_text.contains("result") {
        Some("Test Results".to_string())
    } else if all_text.contains("bug") || all_text.contains("issue") {
        Some("Issues".to_string())
    } else {
        None
    };

    suggestions.insert("suggested_category".to_string(), serde_json::json!(suggested_category));

    let summary = if note.content.chars().count() > 200 {
        let truncated: String = note.content.chars().take(200).collect();
        format!("{}...", truncated)
    } else {
        note.content.clone()
    };
    suggestions.insert("summary".to_string(), serde_json::json!(summary));

    Ok(serde_json::Value::Object(suggestions))
}
