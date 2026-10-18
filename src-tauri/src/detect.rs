//! Detection rules, ported from `docs/tg_join_cleaner.py`.
//!
//! Kept free of network code so the rules can be unit-tested and shared by
//! the scan and the pre-delete re-check.

use grammers_client::tl;
use serde::Serialize;

/// What kind of chat a dialog is, reduced to what the rules need.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatKind {
    User { is_self: bool, is_bot: bool },
    /// Groups, channels and communities.
    Other,
}

/// A kind of chat Sift can clear. The scan, the results screen and the
/// pre-delete re-check all work per category, so future filters (deleted
/// accounts with history, chats inactive for N months) slot in as new variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    /// The chat's only message is the "joined Telegram" notice.
    JoinedOnly,
}

impl Category {
    /// Every category, in the order the results screen lists them.
    pub const ALL: [Category; 1] = [Category::JoinedOnly];

    /// How many latest messages `confirm` needs to see.
    pub const fn messages_needed(self) -> usize {
        match self {
            Category::JoinedOnly => 2,
        }
    }

    /// Cheap test on what the chat list already returned (no extra request).
    pub fn may_match(self, kind: ChatKind, last_action: Option<&tl::enums::MessageAction>) -> bool {
        match self {
            Category::JoinedOnly => passes_cheap_check(kind, last_action),
        }
    }

    /// Strict test on the chat's latest messages, newest first. The scan uses
    /// it, and the delete step runs it again right before removing a chat.
    pub fn confirm(self, recent_actions: &[Option<tl::enums::MessageAction>]) -> bool {
        match self {
            Category::JoinedOnly => passes_strict_check(recent_actions),
        }
    }
}

/// Rule 2: Telegram marks these as a distinct service action, so this is an
/// exact match, never a text search on "joined Telegram".
pub fn is_join_notice(action: Option<&tl::enums::MessageAction>) -> bool {
    matches!(action, Some(tl::enums::MessageAction::ContactSignUp))
}

/// Rules 1, 2 and 4: a private chat with a real user (deleted accounts count;
/// bots and Saved Messages don't), whose latest message is the join notice.
pub fn passes_cheap_check(kind: ChatKind, last_action: Option<&tl::enums::MessageAction>) -> bool {
    match kind {
        ChatKind::User { is_self: false, is_bot: false } => is_join_notice(last_action),
        _ => false,
    }
}

/// Rule 3: after fetching up to 2 messages, the join notice must be the only one.
pub fn passes_strict_check(recent_actions: &[Option<tl::enums::MessageAction>]) -> bool {
    recent_actions.len() == 1 && is_join_notice(recent_actions[0].as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tl::enums::MessageAction as A;

    const USER: ChatKind = ChatKind::User { is_self: false, is_bot: false };

    #[test]
    fn matches_join_notice_from_user() {
        assert!(passes_cheap_check(USER, Some(&A::ContactSignUp)));
    }

    #[test]
    fn skips_groups_bots_and_saved_messages() {
        let join = Some(&A::ContactSignUp);
        assert!(!passes_cheap_check(ChatKind::Other, join));
        assert!(!passes_cheap_check(ChatKind::User { is_self: false, is_bot: true }, join));
        assert!(!passes_cheap_check(ChatKind::User { is_self: true, is_bot: false }, join));
    }

    #[test]
    fn skips_regular_and_other_service_messages() {
        assert!(!passes_cheap_check(USER, None));
        assert!(!passes_cheap_check(USER, Some(&A::Empty)));
    }

    #[test]
    fn strict_check_needs_join_notice_as_only_message() {
        assert!(passes_strict_check(&[Some(A::ContactSignUp)]));
        assert!(!passes_strict_check(&[]));
        assert!(!passes_strict_check(&[None]));
        assert!(!passes_strict_check(&[Some(A::ContactSignUp), None]));
        assert!(!passes_strict_check(&[None, Some(A::ContactSignUp)]));
    }

    #[test]
    fn joined_only_category_uses_the_same_rules() {
        let c = Category::JoinedOnly;
        assert!(c.may_match(USER, Some(&A::ContactSignUp)));
        assert!(!c.may_match(ChatKind::Other, Some(&A::ContactSignUp)));
        assert!(c.confirm(&[Some(A::ContactSignUp)]));
        // Re-check before delete: a reply arrived after the scan.
        assert!(!c.confirm(&[None, Some(A::ContactSignUp)]));
        assert_eq!(c.messages_needed(), 2);
    }
}
