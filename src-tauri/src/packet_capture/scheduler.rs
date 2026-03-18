use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::time::{interval, Duration};
use chrono::{DateTime, Utc};
use crate::commands::packet_capture::{get_scheduled_captures_due, start_capture, ScheduledCaptureInfo};

#[derive(Clone)]
pub struct ScheduledCaptureScheduler {
    running: Arc<tokio::sync::Mutex<bool>>,
}

impl ScheduledCaptureScheduler {
    pub fn new() -> Self {
        Self {
            running: Arc::new(tokio::sync::Mutex::new(false)),
        }
    }

    pub async fn start(&self) -> Result<()> {
        let mut running = self.running.lock().await;
        if *running {
            return Ok(());
        }
        *running = true;
        drop(running);

        let running_clone = Arc::clone(&self.running);
        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(30)); // Check every 30 seconds
            let mut consecutive_failures: u32 = 0;
            loop {
                interval.tick().await;
                
                // Check if still running
                let is_running = *running_clone.lock().await;
                if !is_running {
                    break;
                }

                // Check for due captures
                match Self::check_and_start_due_captures().await {
                    Ok(_) => {
                        consecutive_failures = 0;
                    }
                    Err(e) => {
                        consecutive_failures += 1;
                        // Only log the first few failures to avoid spamming
                        if consecutive_failures <= 3 {
                            tracing::error!("Error checking due captures: {}", e);
                        }
                    }
                }
            }
        });

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        *running = false;
    }

    async fn check_and_start_due_captures() -> Result<()> {
        // Get all due captures
        let due_captures = get_scheduled_captures_due()
            .map_err(|e| anyhow::anyhow!("Failed to get due captures: {}", e))?;

        for capture in due_captures {
            tracing::info!("Starting scheduled capture: {}", capture.name);
            
            // Start the capture
            match start_capture(
                capture.name.clone(),
                capture.description.clone(),
                capture.interface.clone(),
                capture.filter_config.clone(),
            ) {
                Ok(session_id) => {
                    tracing::info!("Started capture session: {}", session_id);
                    
                    // Update last_run and calculate next_run
                    Self::update_capture_after_run(&capture).await?;
                }
                Err(e) => {
                    tracing::error!("Failed to start capture {}: {}", capture.name, e);
                }
            }
        }

        Ok(())
    }

    async fn update_capture_after_run(capture: &ScheduledCaptureInfo) -> Result<()> {
        use crate::core::database;
        let conn = database::Database::get_connection()
            .context("Failed to get database connection")?;
        
        let now = Utc::now().to_rfc3339();
        
        // Update last_run
        conn.execute(
            "UPDATE scheduled_captures SET last_run = ?1 WHERE id = ?2",
            rusqlite::params![now, capture.id],
        )
        .context("Failed to update last_run")?;

        // Calculate next_run based on schedule_type
        let next_run = if capture.schedule_type == "one_time" {
            // One-time captures don't run again
            None
        } else {
            // For recurring, calculate next run time
            // Simple implementation: if scheduled_time is a cron-like expression or time,
            // we'll need to parse it. For now, assume it's a time string we can parse.
            // This is a simplified version - a full implementation would parse cron expressions
            if let Ok(dt) = DateTime::parse_from_rfc3339(&capture.scheduled_time) {
                // If it's a time-only format, add 24 hours for daily recurrence
                // This is a simplified approach - full cron parsing would be better
                let next = dt.with_timezone(&Utc) + chrono::Duration::days(1);
                Some(next.to_rfc3339())
            } else {
                // Try to parse as time-only (HH:MM:SS)
                // For now, just add 24 hours from now for daily recurrence
                let next = Utc::now() + chrono::Duration::days(1);
                Some(next.to_rfc3339())
            }
        };

        // Update next_run
        if let Some(nr) = next_run {
            conn.execute(
                "UPDATE scheduled_captures SET next_run = ?1 WHERE id = ?2",
                rusqlite::params![nr, capture.id],
            )
            .context("Failed to update next_run")?;
        } else {
            // Disable one-time captures after they run
            conn.execute(
                "UPDATE scheduled_captures SET enabled = 0, next_run = NULL WHERE id = ?1",
                rusqlite::params![capture.id],
            )
            .context("Failed to disable one-time capture")?;
        }

        Ok(())
    }
}

impl Default for ScheduledCaptureScheduler {
    fn default() -> Self {
        Self::new()
    }
}
