import { useEffect, useMemo, useState } from 'react';
import { activeProject } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { activeSessionId, sendPromptToSession } from '$lib/stores/terminal';
import {
  addSnippet,
  deleteSnippet,
  loadGlobalSnippets,
  loadProjectSnippets,
  snippets,
  updateSnippet,
  type ShellSnippet,
} from '$lib/stores/snippets';
import { useStore } from '$lib/react/useStore';
import './TerminalSnippetsPanel.css';

type Scope = 'global' | 'project';

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function RunIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

export default function TerminalSnippetsPanel() {
  const project = useStore(activeProject);
  const sessionId = useStore(activeSessionId);
  const allSnippets = useStore(snippets);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentScope, setCurrentScope] = useState<Scope>('global');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formDescription, setFormDescription] = useState('');

  useEffect(() => {
    loadGlobalSnippets();
  }, []);

  useEffect(() => {
    if (project) {
      void loadProjectSnippets(project);
    }
  }, [project]);

  useEffect(() => {
    if (currentScope === 'project' && !project) {
      setCurrentScope('global');
    }
  }, [currentScope, project]);

  const filteredSnippets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const isProjectScope = currentScope === 'project';

    return allSnippets.filter((snippet) => {
      if (isProjectScope) {
        if (!project || snippet.projectId !== project.id) return false;
      } else if (snippet.projectId !== undefined) {
        return false;
      }

      if (!query) return true;
      return (
        snippet.name.toLowerCase().includes(query) ||
        snippet.command.toLowerCase().includes(query) ||
        snippet.description.toLowerCase().includes(query)
      );
    });
  }, [allSnippets, currentScope, project, searchQuery]);

  function resetForm() {
    setFormName('');
    setFormCommand('');
    setFormDescription('');
    setEditingId(null);
    setShowForm(false);
  }

  function handleSave() {
    const name = formName.trim();
    const command = formCommand.trim();
    const description = formDescription.trim();

    if (!name || !command) {
      showToast('Name and Command are required', 'warning');
      return;
    }

    const projectId = currentScope === 'project' && project ? project.id : undefined;
    if (editingId) {
      updateSnippet(editingId, name, command, description);
      showToast('Snippet updated', 'success');
    } else {
      addSnippet(name, command, description, projectId);
      showToast('Snippet created', 'success');
    }

    resetForm();
  }

  function handleEdit(snippet: ShellSnippet) {
    setFormName(snippet.name);
    setFormCommand(snippet.command);
    setFormDescription(snippet.description);
    setEditingId(snippet.id);
    setCurrentScope(snippet.projectId ? 'project' : 'global');
    setShowForm(true);
  }

  function handleDelete(id: string) {
    if (confirm('Are you sure you want to delete this snippet?')) {
      deleteSnippet(id);
      showToast('Snippet deleted', 'info');
    }
  }

  function runSnippet(command: string) {
    if (sessionId === null) {
      showToast('No active terminal session focused', 'warning');
      return;
    }
    sendPromptToSession(sessionId, command);
    showToast('Command sent to terminal', 'success');
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      showToast('Command copied to clipboard', 'info');
    });
  }

  function toggleForm() {
    setShowForm((value) => {
      const next = !value;
      if (next) setEditingId(null);
      return next;
    });
  }

  return (
    <div className="snippets-panel">
      <div className="panel-header">
        <h3 className="panel-title">Shell Snippets</h3>
        <button className="add-btn" onClick={toggleForm} title={showForm ? 'Cancel' : 'Add Snippet'}>
          {showForm ? <XIcon /> : <PlusIcon />}
        </button>
      </div>

      {showForm && (
        <div className="creator-form bento-card">
          <div className="form-title">{editingId ? 'Edit Snippet' : 'Create Snippet'}</div>

          <div className="input-wrap">
            <label htmlFor="sn-name" className="field-label">Name</label>
            <input id="sn-name" type="text" className="input-box" value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="e.g. Run Build" />
          </div>

          <div className="input-wrap">
            <label htmlFor="sn-desc" className="field-label">Description</label>
            <input id="sn-desc" type="text" className="input-box" value={formDescription} onChange={(event) => setFormDescription(event.target.value)} placeholder="What this command does..." />
          </div>

          <div className="input-wrap">
            <label htmlFor="sn-command" className="field-label">Command</label>
            <textarea id="sn-command" className="input-box command-area" value={formCommand} onChange={(event) => setFormCommand(event.target.value)} placeholder="e.g. npm run build" />
          </div>

          {project && (
            <div className="input-wrap scope-wrap">
              <span className="field-label">Scope</span>
              <div className="scope-toggle-group">
                <button type="button" className={`toggle-opt${currentScope === 'global' ? ' active' : ''}`} onClick={() => setCurrentScope('global')}>
                  Global
                </button>
                <button type="button" className={`toggle-opt${currentScope === 'project' ? ' active' : ''}`} onClick={() => setCurrentScope('project')}>
                  Project
                </button>
              </div>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={resetForm}>Cancel</button>
            <button type="button" className="btn-save" onClick={handleSave}>Save</button>
          </div>
        </div>
      )}

      {project && !showForm && (
        <div className="scope-tabs">
          <button className={`scope-tab${currentScope === 'global' ? ' active' : ''}`} onClick={() => setCurrentScope('global')}>
            Global
          </button>
          <button className={`scope-tab${currentScope === 'project' ? ' active' : ''}`} onClick={() => setCurrentScope('project')}>
            Project ({project.name})
          </button>
        </div>
      )}

      {!showForm && (
        <div className="search-bar">
          <input type="text" className="search-input" placeholder="Search snippets..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
        </div>
      )}

      <div className="snippet-list scrollable">
        {filteredSnippets.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">[]</span>
            <span>No snippets found</span>
            {!showForm && <button className="empty-action" onClick={() => setShowForm(true)}>Create one now</button>}
          </div>
        ) : (
          filteredSnippets.map((snippet) => (
            <div className="snippet-card bento-card" key={snippet.id}>
              <div className="card-top">
                <div className="card-info">
                  <div className="snippet-name">{snippet.name}</div>
                  {snippet.description && <div className="snippet-desc">{snippet.description}</div>}
                </div>
                <div className="card-actions">
                  <button className="icon-btn edit-btn" onClick={() => handleEdit(snippet)} title="Edit">
                    <EditIcon />
                  </button>
                  <button className="icon-btn delete-btn" onClick={() => handleDelete(snippet.id)} title="Delete">
                    <DeleteIcon />
                  </button>
                </div>
              </div>
              <div className="card-body">
                <code className="command-box">{snippet.command}</code>
              </div>
              <div className="card-footer">
                <button className="action-btn copy-btn" onClick={() => copyToClipboard(snippet.command)} title="Copy Command">
                  Copy
                </button>
                <button className="action-btn run-btn" onClick={() => runSnippet(snippet.command)} title="Run in active terminal">
                  <RunIcon />
                  Run
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
