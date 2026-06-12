<!-- ToolboxPanel.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.svelte';
  import EmbeddedPanel from '$lib/components/toolbox/EmbeddedPanel.svelte';
  import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';

  type UtilityTab = 'jwt' | 'json' | 'regex' | 'epoch' | 'coder' | 'embedded';
  let activeTab = $state<UtilityTab>('jwt');

  // JWT state
  let jwtInput = $state('');
  let jwtHeader = $derived.by(() => {
    try {
      if (!jwtInput.trim()) return '';
      const parts = jwtInput.split('.');
      if (parts.length < 2) return 'Invalid JWT structure';
      return JSON.stringify(JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))), null, 2);
    } catch (err: any) {
      return `Failed to decode header: ${err.message}`;
    }
  });
  let jwtPayload = $derived.by(() => {
    try {
      if (!jwtInput.trim()) return '';
      const parts = jwtInput.split('.');
      if (parts.length < 2) return 'Invalid JWT structure';
      return JSON.stringify(JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))), null, 2);
    } catch (err: any) {
      return `Failed to decode payload: ${err.message}`;
    }
  });

  // JSON state
  let jsonInput = $state('');
  let jsonIndent = $state('2');
  const indentOptions: DropdownOption[] = [
    { value: '2', label: '2 Spaces' },
    { value: '4', label: '4 Spaces' },
    { value: 'tab', label: 'Tab Indent' }
  ];
  let jsonOutput = $state('');
  let jsonError = $state('');

  function formatJson() {
    jsonError = '';
    try {
      if (!jsonInput.trim()) {
        jsonOutput = '';
        return;
      }
      const parsed = JSON.parse(jsonInput);
      const space = jsonIndent === 'tab' ? '\t' : parseInt(jsonIndent, 10);
      jsonOutput = JSON.stringify(parsed, null, space);
    } catch (err: any) {
      jsonError = err.message;
      jsonOutput = '';
    }
  }

  function minifyJson() {
    jsonError = '';
    try {
      if (!jsonInput.trim()) {
        jsonOutput = '';
        return;
      }
      const parsed = JSON.parse(jsonInput);
      jsonOutput = JSON.stringify(parsed);
    } catch (err: any) {
      jsonError = err.message;
      jsonOutput = '';
    }
  }

  // Regex state
  let regexPattern = $state('([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,6})');
  let regexFlags = $state('g');
  let regexText = $state('Contact us at support@soryq.dev or admin@soryq.dev.');
  let regexReplace = $state('[email]');
  
  let regexMatches = $derived.by(() => {
    try {
      if (!regexPattern) return [];
      const re = new RegExp(regexPattern, regexFlags);
      const matches: string[] = [];
      let match;
      if (regexFlags.includes('g')) {
        while ((match = re.exec(regexText)) !== null) {
          matches.push(match[0]);
          if (re.lastIndex === match.index) {
            re.lastIndex++; // Prevent infinite loops for zero-width matches
          }
        }
      } else {
        match = re.exec(regexText);
        if (match) matches.push(match[0]);
      }
      return matches;
    } catch (err) {
      return ['Invalid Regular Expression'];
    }
  });

  let regexReplacedText = $derived.by(() => {
    try {
      if (!regexPattern) return regexText;
      const re = new RegExp(regexPattern, regexFlags);
      return regexText.replace(re, regexReplace);
    } catch (err) {
      return 'Replacement error';
    }
  });

  // Epoch state
  let epochInput = $state(Math.floor(Date.now() / 1000).toString());
  let dateInput = $state(new Date().toISOString());
  let currentEpoch = $state(Math.floor(Date.now() / 1000));
  let timerId: any;

  onMount(() => {
    timerId = setInterval(() => {
      currentEpoch = Math.floor(Date.now() / 1000);
    }, 1000);
  });

  onDestroy(() => {
    if (timerId) clearInterval(timerId);
  });

  let epochDetails = $derived.by(() => {
    try {
      let num = parseFloat(epochInput);
      if (isNaN(num)) return null;
      // Handle milliseconds
      if (epochInput.length >= 13) num = num / 1000;
      const d = new Date(num * 1000);
      return {
        local: d.toString(),
        utc: d.toUTCString(),
        iso: d.toISOString(),
        relative: getRelativeTimeString(d.getTime())
      };
    } catch {
      return null;
    }
  });

  let dateToEpochResult = $derived.by(() => {
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return 'Invalid Date';
      const sec = Math.floor(d.getTime() / 1000);
      const ms = d.getTime();
      return `Seconds: ${sec}\nMilliseconds: ${ms}`;
    } catch {
      return 'Invalid Date';
    }
  });

  function useCurrentEpoch() {
    epochInput = currentEpoch.toString();
  }

  function getRelativeTimeString(time: number): string {
    const elapsed = time - Date.now();
    const isPast = elapsed < 0;
    const absElapsed = Math.abs(elapsed);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const units: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
      { unit: 'year', ms: 31536000000 },
      { unit: 'month', ms: 2629800000 },
      { unit: 'day', ms: 86400000 },
      { unit: 'hour', ms: 3600000 },
      { unit: 'minute', ms: 60000 },
      { unit: 'second', ms: 1000 }
    ];
    for (const { unit, ms } of units) {
      if (absElapsed >= ms || unit === 'second') {
        const count = Math.round(absElapsed / ms);
        return rtf.format(isPast ? -count : count, unit);
      }
    }
    return '';
  }

  // Base64 & URL state
  let coderInput = $state('');
  let coderOutput = $state('');

  function coderAction(action: 'b64e' | 'b64d' | 'urle' | 'urld') {
    try {
      if (action === 'b64e') {
        // Handle unicode base64 safely
        coderOutput = btoa(encodeURIComponent(coderInput).replace(/%([0-9A-F]{2})/g, (_, p1) => {
          return String.fromCharCode(parseInt(p1, 16));
        }));
      } else if (action === 'b64d') {
        coderOutput = decodeURIComponent(atob(coderInput).split('').map((c) => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
      } else if (action === 'urle') {
        coderOutput = encodeURIComponent(coderInput);
      } else if (action === 'urld') {
        coderOutput = decodeURIComponent(coderInput);
      }
    } catch (err: any) {
      coderOutput = `Error: ${err.message}`;
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => alert('Copied to clipboard!'))
      .catch(err => alert(`Failed to copy: ${err}`));
  }
</script>

<div class="toolbox">
  <!-- Tabs Header -->
  <div class="toolbox-tabs scrollable" use:clampHorizontalScroll>
    <button class="tab-btn" class:active={activeTab === 'jwt'} onclick={() => activeTab = 'jwt'}>JWT Decoder</button>
    <button class="tab-btn" class:active={activeTab === 'json'} onclick={() => activeTab = 'json'}>JSON Format</button>
    <button class="tab-btn" class:active={activeTab === 'regex'} onclick={() => activeTab = 'regex'}>Regex Test</button>
    <button class="tab-btn" class:active={activeTab === 'epoch'} onclick={() => activeTab = 'epoch'}>Epoch</button>
    <button class="tab-btn" class:active={activeTab === 'coder'} onclick={() => activeTab = 'coder'}>Base64/URL</button>
    <button class="tab-btn" class:active={activeTab === 'embedded'} onclick={() => activeTab = 'embedded'}>Embedded</button>
  </div>

  <!-- Content Panels -->
  <div class="toolbox-content">
    
    <!-- JWT Decoder -->
    {#if activeTab === 'jwt'}
      <div class="scrollable-tab-content scrollable">
        <div class="panel-section">
          <label class="section-label">JWT Token</label>
          <textarea
            class="textbox token-input"
            bind:value={jwtInput}
            placeholder="Paste encoded JWT token here..."
          ></textarea>

          {#if jwtInput}
            <div class="jwt-results">
              <div class="result-block header-block">
                <div class="block-title">
                  <span>HEADER</span>
                  <button class="copy-btn" onclick={() => copyToClipboard(jwtHeader)}>Copy</button>
                </div>
                <pre class="json-code">{jwtHeader}</pre>
              </div>
              
              <div class="result-block payload-block">
                <div class="block-title">
                  <span>PAYLOAD (CLAIMS)</span>
                  <button class="copy-btn" onclick={() => copyToClipboard(jwtPayload)}>Copy</button>
                </div>
                <pre class="json-code">{jwtPayload}</pre>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- JSON Formatter -->
    {#if activeTab === 'json'}
      <div class="scrollable-tab-content scrollable">
        <div class="panel-section">
          <div class="json-controls">
            <div class="control-group">
              <label class="section-label">Spacing</label>
              <div style="width: 120px;">
                <Dropdown options={indentOptions} bind:value={jsonIndent} onChange={formatJson} ariaLabel="JSON Spacing" />
              </div>
            </div>
            <div class="json-actions">
              <button class="action-btn" onclick={formatJson}>Format</button>
              <button class="action-btn" onclick={minifyJson}>Minify</button>
            </div>
          </div>

          <div class="json-editors">
            <div class="editor-col">
              <label class="section-label">Input JSON</label>
              <textarea
                class="textbox editor-box"
                bind:value={jsonInput}
                oninput={formatJson}
                placeholder="Paste raw or unformatted JSON here..."
              ></textarea>
            </div>
            <div class="editor-col">
              <div class="block-title">
                <label class="section-label">Formatted JSON</label>
                {#if jsonOutput}
                  <button class="copy-btn" onclick={() => copyToClipboard(jsonOutput)}>Copy</button>
                {/if}
              </div>
              {#if jsonError}
                <div class="error-box">{jsonError}</div>
              {:else}
                <textarea
                  class="textbox editor-box output-box"
                  value={jsonOutput}
                  readonly
                  placeholder="Formatted output will appear here..."
                ></textarea>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Regex Tester -->
    {#if activeTab === 'regex'}
      <div class="scrollable-tab-content scrollable">
        <div class="panel-section">
          <div class="regex-header">
            <div class="input-wrap regex-field">
              <label class="section-label">RegEx Pattern</label>
              <div class="regex-regex-input">
                <span class="regex-slash">/</span>
                <input type="text" class="input-box" bind:value={regexPattern} placeholder="Enter regex pattern..." />
                <span class="regex-slash">/</span>
                <input type="text" class="input-box flags" bind:value={regexFlags} placeholder="flags" style="width: 50px;" />
              </div>
            </div>
            <div class="input-wrap replace-field">
              <label class="section-label">Replace String</label>
              <input type="text" class="input-box" bind:value={regexReplace} placeholder="Replacement..." />
            </div>
          </div>

          <div class="regex-body">
            <div class="editor-col">
              <label class="section-label">Test Text</label>
              <textarea
                class="textbox editor-box"
                bind:value={regexText}
                placeholder="Text to evaluate matches against..."
              ></textarea>
            </div>
            <div class="editor-col">
              <label class="section-label">Matches ({regexMatches.length})</label>
              <div class="match-list scrollable">
                {#each regexMatches as match}
                  <div class="match-item">{match}</div>
                {:else}
                  <div class="no-matches">No matches found</div>
                {/each}
              </div>

              <label class="section-label" style="margin-top: 10px;">Replaced Text</label>
              <textarea
                class="textbox editor-box output-box"
                value={regexReplacedText}
                readonly
              ></textarea>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Epoch Converter -->
    {#if activeTab === 'epoch'}
      <div class="scrollable-tab-content scrollable">
        <div class="panel-section epoch-panel">
          <div class="current-epoch-banner">
            <span class="label">CURRENT EPOCH</span>
            <span class="value">{currentEpoch}</span>
          </div>

          <div class="converter-box">
            <h3>Epoch Timestamp to Date</h3>
            <div class="convert-row">
              <input type="text" class="input-box" bind:value={epochInput} placeholder="Epoch timestamp (seconds or ms)" />
              <button class="action-btn" onclick={useCurrentEpoch}>Use Current</button>
            </div>
            {#if epochDetails}
              <div class="epoch-results">
                <div class="res-item"><span class="label">Local:</span> <span class="val">{epochDetails.local}</span></div>
                <div class="res-item"><span class="label">UTC:</span> <span class="val">{epochDetails.utc}</span></div>
                <div class="res-item"><span class="label">ISO:</span> <span class="val">{epochDetails.iso}</span></div>
                <div class="res-item"><span class="label">Relative:</span> <span class="val">{epochDetails.relative}</span></div>
              </div>
            {/if}
          </div>

          <div class="converter-box">
            <h3>Date to Epoch</h3>
            <div class="convert-row">
              <input type="text" class="input-box" bind:value={dateInput} placeholder="ISO Date string or local format" />
            </div>
            <pre class="epoch-results-raw">{dateToEpochResult}</pre>
          </div>
        </div>
      </div>
    {/if}

    <!-- Base64 & URL Coder -->
    {#if activeTab === 'coder'}
      <div class="scrollable-tab-content scrollable">
        <div class="panel-section coder-panel">
          <div class="json-editors">
            <div class="editor-col">
              <label class="section-label">Input Text</label>
              <textarea
                class="textbox editor-box"
                bind:value={coderInput}
                placeholder="Text to encode or decode..."
              ></textarea>
              <div class="coder-actions">
                <button class="action-btn" onclick={() => coderAction('b64e')}>Base64 Encode</button>
                <button class="action-btn" onclick={() => coderAction('b64d')}>Base64 Decode</button>
                <button class="action-btn" onclick={() => coderAction('urle')}>URL Encode</button>
                <button class="action-btn" onclick={() => coderAction('urld')}>URL Decode</button>
              </div>
            </div>
            <div class="editor-col">
              <div class="block-title">
                <label class="section-label">Output Result</label>
                {#if coderOutput && !coderOutput.startsWith('Error:')}
                  <button class="copy-btn" onclick={() => copyToClipboard(coderOutput)}>Copy</button>
                {/if}
              </div>
              <textarea
                class="textbox editor-box output-box"
                value={coderOutput}
                readonly
                placeholder="Output will appear here..."
              ></textarea>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Embedded Devices -->
    {#if activeTab === 'embedded'}
      <div class="scrollable-tab-content scrollable">
        <EmbeddedPanel />
      </div>
    {/if}

  </div>
</div>

<style>
  .toolbox {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: transparent;
    container-type: inline-size;
  }

  .toolbox-tabs {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    gap: 6px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    white-space: nowrap;
    background: color-mix(in srgb, var(--bg-secondary) 30%, transparent);
    flex-shrink: 0;
  }

  .tab-btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11.5px;
    scroll-snap-align: start;
    font-weight: 550;
    color: var(--text-muted);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all 0.12s;
  }

  .tab-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .tab-btn.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .toolbox-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 14px;
    min-height: 0;
  }

  .scrollable-tab-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
    padding-right: 4px;
    min-height: 0;
  }

  .panel-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }

  .scrollable-tab-content .panel-section {
    height: auto;
  }

  .section-label {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .textbox {
    width: 100%;
    background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    padding: 8px 10px;
    outline: none;
    resize: none;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
  }

  .textbox:focus {
    border-color: var(--accent);
  }

  .token-input {
    height: 80px;
  }

  .jwt-results {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .result-block {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg-secondary) 15%, transparent);
  }

  .block-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: color-mix(in srgb, var(--bg-secondary) 30%, transparent);
    border-bottom: 1px solid var(--border-subtle);
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .header-block .block-title {
    color: var(--warning);
  }

  .payload-block .block-title {
    color: var(--accent);
  }

  .json-code {
    margin: 0;
    padding: 10px 12px;
    font-size: 11.5px;
    font-family: var(--font-mono, monospace);
    overflow-x: auto;
    color: var(--text-secondary);
    max-height: 250px;
  }

  .copy-btn {
    background: transparent;
    border: none;
    font-size: 10px;
    color: var(--accent);
    cursor: pointer;
    font-weight: 600;
  }

  .copy-btn:hover {
    text-decoration: underline;
  }

  /* JSON Formatter styles */
  .json-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .select-box {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 11.5px;
    padding: 3px 6px;
    outline: none;
  }

  .json-actions {
    display: flex;
    gap: 6px;
  }

  .action-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-primary);
    font-size: 11.5px;
    padding: 5px 10px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .action-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }

  .json-editors {
    display: flex;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }

  .editor-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .editor-box {
    flex: 1;
    min-height: 0;
    resize: none;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
  }

  .output-box {
    background: color-mix(in srgb, var(--bg-secondary) 15%, transparent);
  }

  .error-box {
    background: color-mix(in srgb, var(--error) 10%, transparent);
    border: 1px dashed color-mix(in srgb, var(--error) 30%, transparent);
    border-radius: 6px;
    padding: 10px;
    color: var(--error);
    font-size: 11.5px;
    font-family: var(--font-mono, monospace);
    overflow-y: auto;
    flex: 1;
  }

  /* Regex tester styles */
  .regex-header {
    display: flex;
    gap: 12px;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 10px;
  }

  .regex-field {
    flex: 2;
  }

  .replace-field {
    flex: 1;
  }

  .regex-regex-input {
    display: flex;
    align-items: center;
    background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .regex-slash {
    padding: 0 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-muted);
    user-select: none;
  }

  .input-box {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    padding: 6px 4px;
    outline: none;
  }

  .input-box.flags {
    text-align: center;
    border-left: 1px solid var(--border-subtle);
    color: var(--warning);
  }

  .regex-body {
    display: flex;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }

  .match-list {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-secondary) 15%, transparent);
    padding: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 100px;
    overflow-y: auto;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
  }

  .match-item {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    padding: 2px 6px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    color: var(--accent);
    border-radius: 4px;
  }

  .no-matches {
    font-size: 11px;
    color: var(--text-muted);
    padding: 4px;
  }

  /* Epoch panel styles */
  .epoch-panel {
    align-items: center;
    padding-top: 10px;
  }

  .current-epoch-banner {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 14px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-radius: 10px;
    width: 100%;
    max-width: 400px;
    margin-bottom: 10px;
  }

  .current-epoch-banner .label {
    font-size: 10px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 1.5px;
  }

  .current-epoch-banner .value {
    font-size: 24px;
    font-weight: 700;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    margin-top: 4px;
  }

  .converter-box {
    width: 100%;
    max-width: 400px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    background: color-mix(in srgb, var(--bg-secondary) 10%, transparent);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .converter-box h3 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .convert-row {
    display: flex;
    gap: 8px;
  }

  .convert-row .input-box {
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-primary);
    padding: 5px 8px;
  }

  .epoch-results {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 8px;
  }

  .res-item {
    font-size: 11.5px;
    display: flex;
  }

  .res-item .label {
    width: 75px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .res-item .val {
    flex: 1;
    color: var(--text-secondary);
    font-family: var(--font-mono, monospace);
  }

  .epoch-results-raw {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 11.5px;
    font-family: var(--font-mono, monospace);
    color: var(--text-secondary);
  }

  /* Coder styles */
  .coder-panel .coder-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .coder-panel .coder-actions .action-btn {
    flex: 1;
    min-width: 100px;
  }

  .scrollable::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .scrollable::-webkit-scrollbar-track {
    background: transparent;
  }

  .scrollable::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.15));
    border-radius: 3px;
  }

  @container (max-width: 580px) {
    .json-editors {
      flex-direction: column;
      flex: none;
      height: auto;
      gap: 16px;
    }
    .regex-body {
      flex-direction: column;
      flex: none;
      height: auto;
      gap: 16px;
    }
    .regex-header {
      flex-direction: column;
      gap: 8px;
    }
    .regex-field, .replace-field {
      flex: none;
      width: 100%;
    }
    .editor-box {
      height: 180px;
      flex: none;
    }
  }
</style>
