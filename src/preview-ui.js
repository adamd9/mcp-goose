/**
 * Preview UI component - injected into HTML pages
 * Provides branch switching, live reload, and Goose run interface
 */

export function buildPreviewUI(branches, currentPath = '/') {
  const sortedBranches = branches.sort((a, b) => {
    // Sort by modification time if available, otherwise alphabetically
    if (a.mtime && b.mtime) return b.mtime - a.mtime;
    return a.name.localeCompare(b.name);
  });

  const styles = `
  <style>
    ._goose_ui{position:fixed;right:16px;bottom:16px;z-index:99999;font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
    ._goose_ui *{box-sizing:border-box}
    ._goose_ui .toggle{width:48px;height:48px;border-radius:50%;background:#111d28;border:2px solid #2a3b4a;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:all .2s}
    ._goose_ui .toggle:hover{background:#1a2a38;transform:scale(1.05)}
    ._goose_ui .toggle svg{width:24px;height:24px;fill:#bde0fe}
    ._goose_ui .panel{display:none;position:absolute;right:0;bottom:60px;width:340px;max-height:520px;background:#111d28;border:2px solid #2a3b4a;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4);flex-direction:column}
    ._goose_ui .panel.open{display:flex}
    ._goose_ui .header{padding:12px 14px;border-bottom:1px solid #2a3b4a;display:flex;align-items:center;justify-content:space-between}
    ._goose_ui .header h3{margin:0;font-size:13px;font-weight:600;color:#dfe9f1;text-transform:uppercase;letter-spacing:.05em}
    ._goose_ui .close{background:none;border:none;color:#8ba3b5;cursor:pointer;font-size:20px;padding:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center}
    ._goose_ui .close:hover{color:#dfe9f1}
    ._goose_ui .search{padding:10px 14px;border-bottom:1px solid #2a3b4a}
    ._goose_ui .search input{width:100%;padding:8px 10px;background:#0a1419;border:1px solid #2a3b4a;border-radius:6px;color:#dfe9f1;font-size:13px;outline:none}
    ._goose_ui .search input:focus{border-color:#3d5a6f}
    ._goose_ui .branches{flex:1;overflow-y:auto;padding:8px 0;min-height:120px;max-height:200px}
    ._goose_ui .branches::-webkit-scrollbar{width:8px}
    ._goose_ui .branches::-webkit-scrollbar-track{background:#0a1419}
    ._goose_ui .branches::-webkit-scrollbar-thumb{background:#2a3b4a;border-radius:4px}
    ._goose_ui .branches::-webkit-scrollbar-thumb:hover{background:#3d5a6f}
    ._goose_ui .branch{display:block;padding:8px 14px;color:#bde0fe;text-decoration:none;transition:background .15s}
    ._goose_ui .branch:hover{background:#18324a}
    ._goose_ui .branch.active{background:#29557a;color:#fff;font-weight:500}
    ._goose_ui .branch.hidden{display:none}
    ._goose_ui .run-section{border-top:1px solid #2a3b4a;padding:12px 14px}
    ._goose_ui .run-section label{display:block;font-size:12px;color:#8ba3b5;margin-bottom:6px;font-weight:500}
    ._goose_ui .run-section .branch-info{font-size:11px;color:#6b8a9a;margin-bottom:8px;font-style:italic}
    ._goose_ui .run-section textarea{width:100%;padding:8px 10px;background:#0a1419;border:1px solid #2a3b4a;border-radius:6px;color:#dfe9f1;font-size:13px;resize:vertical;min-height:60px;font-family:inherit;outline:none}
    ._goose_ui .run-section textarea:focus{border-color:#3d5a6f}
    ._goose_ui .run-section button{width:100%;margin-top:8px;padding:9px 12px;background:#2563eb;border:none;border-radius:6px;color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
    ._goose_ui .run-section button:hover{background:#1d4ed8}
    ._goose_ui .run-section button:disabled{background:#374151;cursor:not-allowed}
    ._goose_ui .hint{padding:8px 14px;font-size:12px;color:#4ade80;background:#0a1419;border-top:1px solid #2a3b4a;opacity:0;transition:opacity .25s}
    ._goose_ui .hint.show{opacity:1}
  </style>`;

  const markup = `
  <div class="_goose_ui">
    <div class="toggle" id="_goose_toggle" title="Preview & Run">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
    </div>
    <div class="panel" id="_goose_panel">
      <div class="header">
        <h3>Preview & Run</h3>
        <button class="close" id="_goose_close">×</button>
      </div>
      <div class="search">
        <input type="text" id="_goose_search" placeholder="Search branches...">
      </div>
      <div class="branches" id="_goose_branches">
        ${sortedBranches.map(b => `<a href="${b.url}" class="branch ${currentPath.startsWith(b.url) ? 'active' : ''}" data-name="${b.name.toLowerCase()}">${b.name}</a>`).join('')}
      </div>
      <div class="run-section">
        <label for="_goose_instruction">Run Goose Task:</label>
        <div class="branch-info" id="_goose_branch_info">Will branch from: <span id="_goose_current_branch">main</span></div>
        <textarea id="_goose_instruction" placeholder="Enter your instruction for Goose..."></textarea>
        <button id="_goose_run_btn">Run Task</button>
      </div>
      <div class="hint" id="_goose_hint"></div>
    </div>
  </div>`;

  const script = `
  <script>
    (function(){
      var toggle = document.getElementById('_goose_toggle');
      var panel = document.getElementById('_goose_panel');
      var close = document.getElementById('_goose_close');
      var search = document.getElementById('_goose_search');
      var branches = document.getElementById('_goose_branches');
      var instruction = document.getElementById('_goose_instruction');
      var runBtn = document.getElementById('_goose_run_btn');
      var hint = document.getElementById('_goose_hint');
      var currentBranchSpan = document.getElementById('_goose_current_branch');

      // Detect and display current branch
      function detectCurrentBranch() {
        var branch = 'main';
        var path = window.location.pathname;
        if (path.startsWith('/.preview/')) {
          var parts = path.split('/');
          if (parts.length >= 3) {
            branch = parts[2];
          }
        }
        return branch;
      }
      
      var currentBranch = detectCurrentBranch();
      if (currentBranchSpan) {
        currentBranchSpan.textContent = currentBranch;
      }

      function showHint(msg, duration) {
        hint.textContent = msg;
        hint.classList.add('show');
        setTimeout(function(){ hint.classList.remove('show'); }, duration || 3000);
      }

      toggle.addEventListener('click', function(){
        panel.classList.toggle('open');
      });

      close.addEventListener('click', function(){
        panel.classList.remove('open');
      });

      search.addEventListener('input', function(){
        var query = search.value.toLowerCase();
        var links = branches.querySelectorAll('.branch');
        links.forEach(function(link){
          var name = link.getAttribute('data-name');
          if (name.includes(query)) {
            link.classList.remove('hidden');
          } else {
            link.classList.add('hidden');
          }
        });
      });

      runBtn.addEventListener('click', function(){
        var text = instruction.value.trim();
        if (!text) {
          showHint('Please enter an instruction', 2000);
          return;
        }
        runBtn.disabled = true;
        runBtn.textContent = 'Running...';
        
        fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, branch: currentBranch })
        })
        .then(function(res){ 
          if (res.status === 409) {
            return res.json().then(function(data) {
              throw new Error(data.error || 'Another task is already running');
            });
          }
          return res.json(); 
        })
        .then(function(data){
          if (data.error) {
            showHint('Error: ' + data.error, 5000);
          } else {
            showHint('Task started: ' + data.jobId, 3000);
            instruction.value = '';
          }
        })
        .catch(function(err){
          showHint(err.message || 'Request failed', 5000);
        })
        .finally(function(){
          runBtn.disabled = false;
          runBtn.textContent = 'Run Task';
        });
      });

      // SSE for live reload
      try {
        var es = new EventSource('/events');
        es.addEventListener('reload', function(ev){
          var data = {};
          try { data = JSON.parse(ev.data || '{}'); } catch(_) {}
          showHint('Updated ' + (data.branch || 'site') + ' — reloading…', 650);
          setTimeout(function(){ location.reload(); }, 650);
        });
      } catch(_) {}
    })();
  </script>`;

  return styles + markup + script;
}
