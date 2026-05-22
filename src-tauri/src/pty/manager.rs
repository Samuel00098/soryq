use crate::pty::session::PtySession;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::RwLock;

pub struct PtyManager {
    sessions: RwLock<HashMap<u32, PtySession>>,
    next_id: AtomicU32,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, session: PtySession) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.sessions.write().unwrap().insert(id, session);
        id
    }

    pub fn get(&self, id: u32) -> Option<PtySession> {
        self.sessions.read().unwrap().get(&id).cloned()
    }

    pub fn remove(&self, id: u32) -> Option<PtySession> {
        self.sessions.write().unwrap().remove(&id)
    }

    pub fn list_ids(&self) -> Vec<u32> {
        self.sessions.read().unwrap().keys().copied().collect()
    }
}
