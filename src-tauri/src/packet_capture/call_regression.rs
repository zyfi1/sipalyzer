use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSipHeaders {
    pub from: Vec<String>,
    pub to: Vec<String>,
    pub contact: Vec<String>,
    pub via: Vec<String>,
    pub supported: Vec<String>,
    pub allow: Vec<String>,
    pub require: Vec<String>,
    pub proxy_require: Vec<String>,
    pub session_expires: Vec<String>,
    pub min_se: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodecNegotiationSummary {
    pub offer_payload_types: Vec<u8>,
    pub answer_payload_types: Vec<u8>,
    pub offer_codecs: Vec<String>,
    pub answer_codecs: Vec<String>,
    pub payload_codec_map: BTreeMap<u8, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallBehaviorSummary {
    pub id: String,
    pub call_id: String,
    pub participants: Vec<String>,
    pub sip_sequence: Vec<String>,
    pub final_response_code: Option<u16>,
    pub headers: NormalizedSipHeaders,
    pub codec: CodecNegotiationSummary,
    pub setup_delay_ms: Option<u64>,
    pub total_duration_ms: Option<u64>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeaderChange {
    pub match_id: String,
    pub header: String,
    pub before_values: Vec<String>,
    pub after_values: Vec<String>,
    pub is_regression: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimerChange {
    pub match_id: String,
    pub setup_delay_before_ms: Option<u64>,
    pub setup_delay_after_ms: Option<u64>,
    pub total_duration_before_ms: Option<u64>,
    pub total_duration_after_ms: Option<u64>,
    pub is_regression: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodecNegotiationChange {
    pub match_id: String,
    pub offer_codecs_before: Vec<String>,
    pub offer_codecs_after: Vec<String>,
    pub answer_codecs_before: Vec<String>,
    pub answer_codecs_after: Vec<String>,
    pub removed_codecs: Vec<String>,
    pub added_codecs: Vec<String>,
    pub is_regression: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseCodeChange {
    pub match_id: String,
    pub before_code: Option<u16>,
    pub after_code: Option<u16>,
    pub is_regression: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MatchedCallPair {
    pub match_id: String,
    pub before_call: CallBehaviorSummary,
    pub after_call: CallBehaviorSummary,
    pub score: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallBehaviorDiffSummary {
    pub before_call_count: usize,
    pub after_call_count: usize,
    pub matched_call_count: usize,
    pub added_call_count: usize,
    pub removed_call_count: usize,
    pub header_change_count: usize,
    pub timer_change_count: usize,
    pub codec_change_count: usize,
    pub response_code_change_count: usize,
    pub regression_count: usize,
    pub has_regressions: bool,
    pub comparable_call_ratio: f64,
    pub is_comparable: bool,
    pub comparability_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallBehaviorDiffResult {
    pub summary: CallBehaviorDiffSummary,
    pub matched_calls: Vec<MatchedCallPair>,
    pub header_changes: Vec<HeaderChange>,
    pub timer_changes: Vec<TimerChange>,
    pub codec_negotiation_changes: Vec<CodecNegotiationChange>,
    pub response_code_changes: Vec<ResponseCodeChange>,
    pub added_calls: Vec<CallBehaviorSummary>,
    pub removed_calls: Vec<CallBehaviorSummary>,
}

pub fn diff_call_behaviors(
    before_calls: Vec<CallBehaviorSummary>,
    after_calls: Vec<CallBehaviorSummary>,
) -> CallBehaviorDiffResult {
    let matches = match_calls(&before_calls, &after_calls);
    let mut used_before = BTreeSet::new();
    let mut used_after = BTreeSet::new();
    let mut matched_calls = Vec::new();
    let mut header_changes = Vec::new();
    let mut timer_changes = Vec::new();
    let mut codec_changes = Vec::new();
    let mut response_code_changes = Vec::new();
    let mut regression_count = 0usize;

    for (i, m) in matches.iter().enumerate() {
        used_before.insert(m.before_idx);
        used_after.insert(m.after_idx);
        let before = before_calls[m.before_idx].clone();
        let after = after_calls[m.after_idx].clone();
        let match_id = format!("match-{:04}", i + 1);
        matched_calls.push(MatchedCallPair {
            match_id: match_id.clone(),
            before_call: before.clone(),
            after_call: after.clone(),
            score: m.score,
        });

        for (header_name, before_values, after_values, is_regression) in
            compare_headers(&before, &after)
        {
            if is_regression {
                regression_count += 1;
            }
            header_changes.push(HeaderChange {
                match_id: match_id.clone(),
                header: header_name,
                before_values,
                after_values,
                is_regression,
            });
        }

        if let Some((is_regression, setup_before, setup_after, dur_before, dur_after)) =
            compare_timers(&before, &after)
        {
            if is_regression {
                regression_count += 1;
            }
            timer_changes.push(TimerChange {
                match_id: match_id.clone(),
                setup_delay_before_ms: setup_before,
                setup_delay_after_ms: setup_after,
                total_duration_before_ms: dur_before,
                total_duration_after_ms: dur_after,
                is_regression,
            });
        }

        if let Some(change) = compare_codecs(&match_id, &before, &after) {
            if change.is_regression {
                regression_count += 1;
            }
            codec_changes.push(change);
        }

        if let Some(change) = compare_response_code(&match_id, &before, &after) {
            if change.is_regression {
                regression_count += 1;
            }
            response_code_changes.push(change);
        }
    }

    let added_calls = after_calls
        .iter()
        .enumerate()
        .filter(|(idx, _)| !used_after.contains(idx))
        .map(|(_, c)| c.clone())
        .collect::<Vec<_>>();
    let removed_calls = before_calls
        .iter()
        .enumerate()
        .filter(|(idx, _)| !used_before.contains(idx))
        .map(|(_, c)| c.clone())
        .collect::<Vec<_>>();

    let denominator = before_calls.len().max(after_calls.len());
    let comparable_call_ratio = if denominator == 0 {
        1.0
    } else {
        matched_calls.len() as f64 / denominator as f64
    };
    let is_comparable = matched_calls.len() > 0 && comparable_call_ratio >= 0.25;
    let comparability_note = if is_comparable {
        None
    } else if matched_calls.is_empty() {
        Some(
            "No overlapping calls found between captures; treat as different populations."
                .to_string(),
        )
    } else {
        Some("Low overlap between captures; regression counts may not represent like-for-like behavior.".to_string())
    };

    let summary = CallBehaviorDiffSummary {
        before_call_count: before_calls.len(),
        after_call_count: after_calls.len(),
        matched_call_count: matched_calls.len(),
        added_call_count: added_calls.len(),
        removed_call_count: removed_calls.len(),
        header_change_count: header_changes.len(),
        timer_change_count: timer_changes.len(),
        codec_change_count: codec_changes.len(),
        response_code_change_count: response_code_changes.len(),
        regression_count,
        has_regressions: is_comparable && regression_count > 0,
        comparable_call_ratio,
        is_comparable,
        comparability_note,
    };

    CallBehaviorDiffResult {
        summary,
        matched_calls,
        header_changes,
        timer_changes,
        codec_negotiation_changes: codec_changes,
        response_code_changes,
        added_calls,
        removed_calls,
    }
}

#[derive(Debug, Clone)]
struct CandidateMatch {
    before_idx: usize,
    after_idx: usize,
    score: i32,
}

fn match_calls(
    before_calls: &[CallBehaviorSummary],
    after_calls: &[CallBehaviorSummary],
) -> Vec<CandidateMatch> {
    let mut candidates = Vec::new();

    for (before_idx, before_call) in before_calls.iter().enumerate() {
        for (after_idx, after_call) in after_calls.iter().enumerate() {
            if !is_plausible_match(before_call, after_call) {
                continue;
            }
            let score = match_score(before_call, after_call);
            if score >= 35 {
                candidates.push(CandidateMatch {
                    before_idx,
                    after_idx,
                    score,
                });
            }
        }
    }

    candidates.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.before_idx.cmp(&b.before_idx))
            .then_with(|| a.after_idx.cmp(&b.after_idx))
    });

    let mut used_before = BTreeSet::new();
    let mut used_after = BTreeSet::new();
    let mut matches = Vec::new();
    for c in candidates {
        if used_before.contains(&c.before_idx) || used_after.contains(&c.after_idx) {
            continue;
        }
        used_before.insert(c.before_idx);
        used_after.insert(c.after_idx);
        matches.push(c);
    }
    matches.sort_by_key(|m| (m.before_idx, m.after_idx));
    matches
}

fn first_sequence_token(call: &CallBehaviorSummary) -> String {
    call.sip_sequence
        .first()
        .map(|s| s.trim().to_ascii_uppercase())
        .unwrap_or_default()
}

fn set_intersection_count(a: &[String], b: &[String]) -> usize {
    let a_set = normalize_set(a);
    let b_set = normalize_set(b);
    a_set.iter().filter(|item| b_set.contains(*item)).count()
}

fn is_plausible_match(before_call: &CallBehaviorSummary, after_call: &CallBehaviorSummary) -> bool {
    let before_start = first_sequence_token(before_call);
    let after_start = first_sequence_token(after_call);
    // Different signaling starts (e.g. INVITE vs OPTIONS) are usually unrelated flows.
    if !before_start.is_empty() && !after_start.is_empty() && before_start != after_start {
        return false;
    }

    let participant_overlap =
        set_intersection_count(&before_call.participants, &after_call.participants);
    let from_overlap = set_intersection_count(&before_call.headers.from, &after_call.headers.from);
    let to_overlap = set_intersection_count(&before_call.headers.to, &after_call.headers.to);
    let identity_overlap = participant_overlap + from_overlap + to_overlap;

    let call_id_equal = !before_call.call_id.is_empty()
        && !after_call.call_id.is_empty()
        && before_call.call_id == after_call.call_id;

    // We only accept Call-ID matches when at least one identity vector also overlaps.
    // This prevents false pairing when two captures contain unrelated dialogs with recycled IDs.
    if call_id_equal {
        return identity_overlap > 0;
    }

    // Without Call-ID parity, require strong identity overlap.
    identity_overlap > 0
}

fn match_score(before_call: &CallBehaviorSummary, after_call: &CallBehaviorSummary) -> i32 {
    let mut score = 0;

    if !before_call.call_id.is_empty() && before_call.call_id == after_call.call_id {
        score += 40;
    }

    let before_parties = normalize_set(&before_call.participants);
    let after_parties = normalize_set(&after_call.participants);
    if !before_parties.is_empty() && before_parties == after_parties {
        score += 45;
    }

    let before_prefix = before_call
        .sip_sequence
        .iter()
        .take(4)
        .cloned()
        .collect::<Vec<_>>();
    let after_prefix = after_call
        .sip_sequence
        .iter()
        .take(4)
        .cloned()
        .collect::<Vec<_>>();
    if !before_prefix.is_empty() && before_prefix == after_prefix {
        score += 25;
    }

    if same_response_class(
        before_call.final_response_code,
        after_call.final_response_code,
    ) {
        score += 10;
    }

    let before_codecs = normalize_set(&before_call.codec.answer_codecs);
    let after_codecs = normalize_set(&after_call.codec.answer_codecs);
    if !before_codecs.is_empty() && !after_codecs.is_empty() {
        let overlap = before_codecs
            .iter()
            .filter(|c| after_codecs.contains(*c))
            .count() as i32;
        score += overlap * 4;
    }

    score
}

fn same_response_class(before: Option<u16>, after: Option<u16>) -> bool {
    match (before, after) {
        (Some(a), Some(b)) => (a / 100) == (b / 100),
        (None, None) => true,
        _ => false,
    }
}

fn compare_headers(
    before: &CallBehaviorSummary,
    after: &CallBehaviorSummary,
) -> Vec<(String, Vec<String>, Vec<String>, bool)> {
    let mut changes = Vec::new();
    let header_pairs = [
        ("from", &before.headers.from, &after.headers.from),
        ("to", &before.headers.to, &after.headers.to),
        ("contact", &before.headers.contact, &after.headers.contact),
        ("via", &before.headers.via, &after.headers.via),
        (
            "supported",
            &before.headers.supported,
            &after.headers.supported,
        ),
        ("allow", &before.headers.allow, &after.headers.allow),
        ("require", &before.headers.require, &after.headers.require),
        (
            "proxyRequire",
            &before.headers.proxy_require,
            &after.headers.proxy_require,
        ),
        (
            "sessionExpires",
            &before.headers.session_expires,
            &after.headers.session_expires,
        ),
        ("minSe", &before.headers.min_se, &after.headers.min_se),
    ];

    for (name, before_values, after_values) in header_pairs {
        let before_norm = normalize_set(before_values);
        let after_norm = normalize_set(after_values);
        if before_norm != after_norm {
            let is_regression = matches!(
                name,
                "require" | "proxyRequire" | "sessionExpires" | "minSe"
            );
            changes.push((name.to_string(), before_norm, after_norm, is_regression));
        }
    }
    changes
}

fn compare_timers(
    before: &CallBehaviorSummary,
    after: &CallBehaviorSummary,
) -> Option<(bool, Option<u64>, Option<u64>, Option<u64>, Option<u64>)> {
    if before.setup_delay_ms == after.setup_delay_ms
        && before.total_duration_ms == after.total_duration_ms
    {
        return None;
    }

    let setup_regression = match (before.setup_delay_ms, after.setup_delay_ms) {
        (Some(b), Some(a)) => a > b.saturating_add(500) && a > (b as f64 * 1.2) as u64,
        (None, Some(_)) => true,
        _ => false,
    };

    let duration_regression = match (before.total_duration_ms, after.total_duration_ms) {
        (Some(b), Some(a)) => b > 5_000 && a.saturating_add(1_000) < (b as f64 * 0.8) as u64,
        _ => false,
    };

    Some((
        setup_regression || duration_regression,
        before.setup_delay_ms,
        after.setup_delay_ms,
        before.total_duration_ms,
        after.total_duration_ms,
    ))
}

fn compare_codecs(
    match_id: &str,
    before: &CallBehaviorSummary,
    after: &CallBehaviorSummary,
) -> Option<CodecNegotiationChange> {
    let offer_before = normalize_set(&before.codec.offer_codecs);
    let offer_after = normalize_set(&after.codec.offer_codecs);
    let answer_before = normalize_set(&before.codec.answer_codecs);
    let answer_after = normalize_set(&after.codec.answer_codecs);

    if offer_before == offer_after && answer_before == answer_after {
        return None;
    }

    let before_union = offer_before
        .iter()
        .chain(answer_before.iter())
        .cloned()
        .collect::<BTreeSet<_>>();
    let after_union = offer_after
        .iter()
        .chain(answer_after.iter())
        .cloned()
        .collect::<BTreeSet<_>>();

    let removed_codecs = before_union
        .difference(&after_union)
        .cloned()
        .collect::<Vec<_>>();
    let added_codecs = after_union
        .difference(&before_union)
        .cloned()
        .collect::<Vec<_>>();

    let is_regression =
        !removed_codecs.is_empty() || (!answer_before.is_empty() && answer_after.is_empty());

    Some(CodecNegotiationChange {
        match_id: match_id.to_string(),
        offer_codecs_before: offer_before,
        offer_codecs_after: offer_after,
        answer_codecs_before: answer_before,
        answer_codecs_after: answer_after,
        removed_codecs,
        added_codecs,
        is_regression,
    })
}

fn compare_response_code(
    match_id: &str,
    before: &CallBehaviorSummary,
    after: &CallBehaviorSummary,
) -> Option<ResponseCodeChange> {
    if before.final_response_code == after.final_response_code {
        return None;
    }

    let before_class = before.final_response_code.map(|c| c / 100);
    let after_class = after.final_response_code.map(|c| c / 100);
    let is_regression = match (before_class, after_class) {
        (Some(2), Some(c)) if c >= 3 => true,
        (Some(1), Some(c)) if c >= 3 => true,
        (Some(_), None) => true,
        _ => false,
    };

    Some(ResponseCodeChange {
        match_id: match_id.to_string(),
        before_code: before.final_response_code,
        after_code: after.final_response_code,
        is_regression,
    })
}

fn normalize_set(values: &[String]) -> Vec<String> {
    let mut set = BTreeSet::new();
    for value in values {
        let norm = value.trim().to_lowercase();
        if !norm.is_empty() {
            set.insert(norm);
        }
    }
    set.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_call(id: &str, call_id: &str) -> CallBehaviorSummary {
        CallBehaviorSummary {
            id: id.to_string(),
            call_id: call_id.to_string(),
            participants: vec!["alice".to_string(), "bob".to_string()],
            sip_sequence: vec![
                "INVITE".to_string(),
                "100".to_string(),
                "180".to_string(),
                "200".to_string(),
                "ACK".to_string(),
            ],
            final_response_code: Some(200),
            headers: NormalizedSipHeaders {
                allow: vec!["INVITE,ACK,BYE".to_string()],
                session_expires: vec!["1800".to_string()],
                ..NormalizedSipHeaders::default()
            },
            codec: CodecNegotiationSummary {
                offer_codecs: vec!["opus".to_string(), "pcmu".to_string()],
                answer_codecs: vec!["opus".to_string()],
                ..CodecNegotiationSummary::default()
            },
            setup_delay_ms: Some(1200),
            total_duration_ms: Some(30_000),
            start_time: Some("2026-01-01T00:00:00Z".to_string()),
            end_time: Some("2026-01-01T00:00:30Z".to_string()),
        }
    }

    #[test]
    fn diff_detects_response_timer_and_codec_regressions() {
        let before = vec![base_call("before-1", "call-a")];
        let mut after_call = base_call("after-1", "call-a");
        after_call.final_response_code = Some(488);
        after_call.setup_delay_ms = Some(3000);
        after_call.total_duration_ms = Some(6000);
        after_call.codec.answer_codecs = vec![];
        let after = vec![after_call];

        let diff = diff_call_behaviors(before, after);
        assert!(diff.summary.has_regressions);
        assert_eq!(diff.summary.matched_call_count, 1);
        assert_eq!(diff.response_code_changes.len(), 1);
        assert!(diff.response_code_changes[0].is_regression);
        assert_eq!(diff.timer_changes.len(), 1);
        assert!(diff.timer_changes[0].is_regression);
        assert_eq!(diff.codec_negotiation_changes.len(), 1);
        assert!(diff.codec_negotiation_changes[0].is_regression);
    }

    #[test]
    fn diff_reports_added_and_removed_calls_when_unmatched() {
        let before = vec![base_call("before-1", "call-before")];
        let mut after_call = base_call("after-1", "call-after");
        after_call.participants = vec!["charlie".to_string(), "dana".to_string()];
        after_call.sip_sequence = vec!["OPTIONS".to_string(), "200".to_string()];
        let after = vec![after_call];

        let diff = diff_call_behaviors(before, after);
        assert_eq!(diff.summary.matched_call_count, 0);
        assert_eq!(diff.added_calls.len(), 1);
        assert_eq!(diff.removed_calls.len(), 1);
    }

    #[test]
    fn same_call_id_without_identity_overlap_does_not_match() {
        let mut before_call = base_call("before-1", "shared-call-id");
        before_call.participants = vec!["alice@pbx-a".to_string(), "bob@pbx-a".to_string()];
        before_call.headers.from = vec!["sip:alice@pbx-a".to_string()];
        before_call.headers.to = vec!["sip:bob@pbx-a".to_string()];

        let mut after_call = base_call("after-1", "shared-call-id");
        after_call.participants = vec!["charlie@pbx-z".to_string(), "dana@pbx-z".to_string()];
        after_call.headers.from = vec!["sip:charlie@pbx-z".to_string()];
        after_call.headers.to = vec!["sip:dana@pbx-z".to_string()];

        let diff = diff_call_behaviors(vec![before_call], vec![after_call]);
        assert_eq!(diff.summary.matched_call_count, 0);
        assert_eq!(diff.added_calls.len(), 1);
        assert_eq!(diff.removed_calls.len(), 1);
        assert_eq!(diff.summary.regression_count, 0);
        assert!(!diff.summary.has_regressions);
        assert!(!diff.summary.is_comparable);
    }

    #[test]
    fn added_removed_only_do_not_count_as_regressions() {
        let before = vec![base_call("before-1", "only-before")];
        let mut after = base_call("after-1", "only-after");
        after.participants = vec!["eve@other".to_string(), "frank@other".to_string()];
        after.headers.from = vec!["sip:eve@other".to_string()];
        after.headers.to = vec!["sip:frank@other".to_string()];

        let diff = diff_call_behaviors(before, vec![after]);
        assert_eq!(diff.summary.matched_call_count, 0);
        assert_eq!(diff.summary.regression_count, 0);
        assert!(!diff.summary.has_regressions);
    }
}
