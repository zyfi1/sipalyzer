//! Schedule window types for controlling when an agent is allowed to connect.

use chrono::{Datelike, NaiveTime, Utc, Weekday};
use serde::{Deserialize, Serialize};

/// A time window during which the agent is allowed to connect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleWindow {
    /// Days of the week this window applies to.
    pub days: Vec<WeekdayWrapper>,
    /// Start time (inclusive), in the agent's local time.
    pub start_time: String, // "HH:MM" format
    /// End time (inclusive), in the agent's local time.
    pub end_time: String, // "HH:MM" format
}

/// Wrapper around `chrono::Weekday` for serde support.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WeekdayWrapper {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

impl WeekdayWrapper {
    pub fn to_chrono(self) -> Weekday {
        match self {
            Self::Monday => Weekday::Mon,
            Self::Tuesday => Weekday::Tue,
            Self::Wednesday => Weekday::Wed,
            Self::Thursday => Weekday::Thu,
            Self::Friday => Weekday::Fri,
            Self::Saturday => Weekday::Sat,
            Self::Sunday => Weekday::Sun,
        }
    }

    pub fn from_chrono(wd: Weekday) -> Self {
        match wd {
            Weekday::Mon => Self::Monday,
            Weekday::Tue => Self::Tuesday,
            Weekday::Wed => Self::Wednesday,
            Weekday::Thu => Self::Thursday,
            Weekday::Fri => Self::Friday,
            Weekday::Sat => Self::Saturday,
            Weekday::Sun => Self::Sunday,
        }
    }
}

impl ScheduleWindow {
    /// Parse the start time string to `NaiveTime`.
    pub fn parse_start(&self) -> Option<NaiveTime> {
        NaiveTime::parse_from_str(&self.start_time, "%H:%M").ok()
    }

    /// Parse the end time string to `NaiveTime`.
    pub fn parse_end(&self) -> Option<NaiveTime> {
        NaiveTime::parse_from_str(&self.end_time, "%H:%M").ok()
    }
}

/// Check if the current UTC time falls within any of the given schedule windows.
/// If the schedule is empty, always returns `true` (no restrictions).
pub fn is_within_schedule(windows: &[ScheduleWindow]) -> bool {
    if windows.is_empty() {
        return true;
    }

    let now = Utc::now();
    let current_day = WeekdayWrapper::from_chrono(now.weekday());
    let current_time = now.time();

    for window in windows {
        if !window.days.contains(&current_day) {
            continue;
        }

        let start = match window.parse_start() {
            Some(t) => t,
            None => continue,
        };
        let end = match window.parse_end() {
            Some(t) => t,
            None => continue,
        };

        if start <= end {
            // Normal window: e.g., 09:00 - 17:00
            if current_time >= start && current_time <= end {
                return true;
            }
        } else {
            // Overnight window: e.g., 22:00 - 06:00
            if current_time >= start || current_time <= end {
                return true;
            }
        }
    }

    false
}
