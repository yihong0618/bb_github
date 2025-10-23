// ==UserScript==
// @name         GitHub Dashboard Recent Activity Restorer
// @namespace    https://tampermonkey.net/
// @version      0.1.1
// @description  Restore the "Recent activity" quick links on the GitHub dashboard using the official GraphQL API.
// @author       hyi
// @match        https://github.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // Immediately log to confirm script is loaded
  console.log('[Recent Activity] ========================================');
  console.log('[Recent Activity] Script loaded and executing!');
  console.log('[Recent Activity] Current URL:', window.location.href);
  console.log('[Recent Activity] Document readyState:', document.readyState);
  console.log('[Recent Activity] ========================================');

  // Intercept fetch requests to capture token
  let capturedToken = null;
  // Read user configured token from localStorage
  function getStoredToken() {
    return localStorage.getItem('github-recent-activity-token');
  }

  function setStoredToken(token) {
    localStorage.setItem('github-recent-activity-token', token);
    capturedToken = token;
  }
  const originalFetch = window.fetch;

  window.fetch = function (...args) {
    const [url, options] = args;

    // Intercept GraphQL requests
    if (url && (url.includes('api.github.com/graphql') || url.includes('github.com/graphql'))) {
      const authHeader = options?.headers?.Authorization || options?.headers?.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        capturedToken = token;
        console.log('[Recent Activity] ✓ Captured token from GitHub request!');
        // Auto-save to localStorage
        setStoredToken(token);
      }
    }

    return originalFetch.apply(this, args);
  };
  // Load token from localStorage on initialization
  capturedToken = getStoredToken();
  if (capturedToken) {
    console.log('[Recent Activity] ✓ Loaded token from localStorage');
  }

  const PANEL_ID = 'tm-recent-activity-panel';
  const QUERY = `
    query HomeRecentActivities($activityLimit: Int = 10, $skipRecent: Boolean = false) {
      viewer {
        __typename
        id
        ...HomeRecentActivityFragment
      }
    }
    fragment HomeRecentActivityFragment on User {
      __typename
      recentInteractions(limit: $activityLimit) @skip(if: $skipRecent) {
        __typename
        commentId
        interaction
        occurredAt
        commenter {
          __typename
          id
          login
        }
        interactable {
          __typename
          ... on PullRequest {
            id
            title
            pullRequestHtmlTitle: titleHTML
            number
            isReadByViewer
            createdAt
            totalCommentsCount
            author {
              __typename
              login
            }
            repository {
              __typename
              id
              name
              owner {
                __typename
                id
                login
              }
            }
          }
          ... on Issue {
            id
            url
            title
            issueHtmlTitle: titleHTML
            number
            issueState: state
            stateReason
            isReadByViewer
            createdAt
            comments {
              __typename
              totalCount
            }
            author {
              __typename
              login
            }
            repository {
              __typename
              id
              name
              owner {
                __typename
                id
                login
              }
            }
          }
        }
      }
    }
  `;

  const DASHBOARD_PATHS = new Set(['/', '/dashboard']);

  function isDashboard() {
    if (location.pathname.startsWith('/dashboard')) {
      return true;
    }
    const normalizedPath = location.pathname.replace(/\/$/, '') || '/';
    return DASHBOARD_PATHS.has(normalizedPath) && !location.pathname.startsWith('/dashboard/notifications');
  }

  // Use GM_xmlhttpRequest to bypass CORS
  async function fetchRecentActivityViaGraphQL() {
    console.log('[Recent Activity] Fetching via GitHub GraphQL API');

    const token = capturedToken || getStoredToken();

    if (!token) {
      console.error('[Recent Activity] No token available yet.');
      throw new Error('No authentication token available. Please configure token.');
    }

    console.log('[Recent Activity] Using token');
    const body = {
      operationName: 'HomeRecentActivities',
      query: QUERY,
      variables: { activityLimit: 10, skipRecent: false }
    };
    console.log('[Recent Activity] Calling: https://api.github.com/graphql');
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.github.com/graphql',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        },
        data: JSON.stringify(body),
        onload(response) {
          console.log('[Recent Activity] API Response status:', response.status);

          if (response.status !== 200) {
            console.error('[Recent Activity] API Error:', response.responseText.substring(0, 500));
            reject(new Error(`GitHub GraphQL request failed: ${response.status}`));
            return;
          }

          try {
            const payload = JSON.parse(response.responseText);
            console.log('[Recent Activity] API Response:', payload);

            if (payload.errors?.length) {
              console.error('[Recent Activity] GraphQL Errors:', payload.errors);
              reject(new Error(payload.errors.map((error) => error.message).join('\n')));
              return;
            }

            const activities = payload.data?.viewer?.recentInteractions ?? [];
            console.log(`[Recent Activity] Found ${activities.length} activities`);
            resolve(activities);
          } catch (error) {
            console.error('[Recent Activity] Parse error:', error);
            reject(error);
          }
        },
        onerror(error) {
          console.error('[Recent Activity] Request error:', error);
          reject(new Error('Failed to fetch from GitHub API'));
        }
      });
    });
  }

  function waitForSidebar(timeoutMs = 8000) {
    const selectors = [
      '.dashboard-sidebar',
      '.Layout .Layout-sidebar',
      'main .Layout-sidebar',
      'main aside',
      '.application-main aside'
    ];

    return new Promise((resolve, reject) => {
      console.log('[Recent Activity] Checking for existing sidebar...');
      const existing = selectors.map((selector) => {
        const el = document.querySelector(selector);
        if (el) {
          console.log(`[Recent Activity] Found sidebar with selector: ${selector}`, el);
        }
        return el;
      }).find(Boolean);

      if (existing) {
        console.log('[Recent Activity] Sidebar already exists');
        resolve(existing);
        return;
      }

      console.log('[Recent Activity] Sidebar not found, waiting...');
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        console.error('[Recent Activity] Timeout waiting for sidebar');
        reject(new Error('Timed out waiting for the GitHub dashboard sidebar.'));
      }, timeoutMs);

      const observer = new MutationObserver(() => {
        const sidebar = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
        if (sidebar) {
          console.log('[Recent Activity] Sidebar appeared');
          clearTimeout(timeoutId);
          observer.disconnect();
          resolve(sidebar);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  function ensurePanel(sidebar) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      console.log('[Recent Activity] Creating new panel');
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.className = 'border-bottom py-3';
      panel.innerHTML = `
        <h2 class="h5 mb-2 text-normal">
          Recent
          <button id="tm-refresh-recent-activity" class="btn-link float-right" type="button" title="Refresh">
            <svg class="octicon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
              <path fill-rule="evenodd" d="M8 2.5a5.487 5.487 0 00-4.131 1.869l1.204 1.204A.25.25 0 014.896 6H1.25A.25.25 0 011 5.75V2.104a.25.25 0 01.427-.177l1.38 1.38A7.001 7.001 0 0114.95 7.16a.75.75 0 11-1.49.178A5.501 5.501 0 008 2.5zM1.705 8.005a.75.75 0 01.834.656 5.501 5.501 0 009.592 2.97l-1.204-1.204a.25.25 0 01.177-.427h3.646a.25.25 0 01.25.25v3.646a.25.25 0 01-.427.177l-1.38-1.38A7.001 7.001 0 011.05 8.84a.75.75 0 01.656-.834z"></path>
            </svg>
          </button>
        </h2>
        <div id="tm-recent-activity-body">
          <p class="text-gray text-small m-0">Loading...</p>
        </div>
      `;
      console.log('[Recent Activity] Panel HTML created');
      // Find the "Top repositories" section
      const headings = sidebar.querySelectorAll('h2');
      let topReposSection = null;
      for (const heading of headings) {
        if (heading.textContent.includes('Top repositories')) {
          // Find the outermost container containing this heading
          topReposSection = heading.closest('div.border-bottom') || heading.parentElement.closest('div');
          break;
        }
      }
      if (topReposSection && topReposSection.nextSibling) {
        // Insert after the Top repositories container
        topReposSection.parentNode.insertBefore(panel, topReposSection.nextSibling);
        console.log('[Recent Activity] Panel inserted after Top repositories');
      } else if (topReposSection) {
        // If it's the last element, append to parent container
        topReposSection.parentNode.appendChild(panel);
        console.log('[Recent Activity] Panel appended after Top repositories (last child)');
      } else {
        // If Top repositories not found, append to sidebar end
        sidebar.appendChild(panel);
        console.log('[Recent Activity] Panel appended to sidebar end');
      }
    } else {
      console.log('[Recent Activity] Panel already exists, reusing');
    }

    return panel;
  }

  function renderLoading(panel) {
    const body = panel.querySelector('#tm-recent-activity-body');
    if (body) {
      body.innerHTML = '<p class="text-gray text-small m-0">Loading...</p>';
    }
  }

  function renderError(panel, error) {
    const body = panel.querySelector('#tm-recent-activity-body');
    if (!body) {
      return;
    }

    body.innerHTML = `<p class="text-red text-small m-0">Failed to load: ${error.message}</p>`;
  }

  function renderActivities(panel, activities) {
    console.log('[Recent Activity] renderActivities called with', activities.length, 'activities');
    const body = panel.querySelector('#tm-recent-activity-body');
    console.log('[Recent Activity] Body element:', body);
    if (!body) {
      console.error('[Recent Activity] Body not found!');
      return;
    }

    if (!activities.length) {
      body.innerHTML = '<p class="text-gray text-small m-0">No recent activities</p>';
      return;
    }

    const list = document.createElement('div');
    list.className = 'd-flex flex-column';

    for (const activity of activities) {
      console.log('[Recent Activity] Rendering activity:', activity);
      const item = document.createElement('div');
      item.className = 'd-flex py-2';
      item.style.borderBottom = '1px solid var(--borderColor-default, #d0d7de)';

      // Left icon
      const iconDiv = document.createElement('div');
      iconDiv.className = 'mr-2';
      const interactable = activity.interactable;
      const isPR = interactable?.__typename === 'PullRequest';
      // Use simple emoji icons
      const iconSpan = document.createElement('span');
      iconSpan.style.fontSize = '20px';
      iconSpan.textContent = isPR ? '🔀' : '📋';
      iconDiv.appendChild(iconSpan);

      // Right content
      const contentDiv = document.createElement('div');
      contentDiv.className = 'flex-1 min-width-0';

      if (interactable) {
        const repoOwner = interactable.repository?.owner?.login ?? '';
        const repoName = interactable.repository?.name ?? '';
        const repoSlug = `${repoOwner}/${repoName}`;
        const number = interactable.number;
        const url = isPR
          ? `https://github.com/${repoSlug}/pull/${number}`
          : interactable.url || `https://github.com/${repoSlug}/issues/${number}`;
        // First line: repository/title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'text-small lh-condensed';
        const titleLink = document.createElement('a');
        titleLink.className = 'Link--primary no-underline text-bold';
        titleLink.href = url;
        titleLink.style.color = 'var(--fgColor-default)';
        titleLink.textContent = `${repoSlug} #${number}`;
        titleDiv.appendChild(titleLink);

        // Second line: title
        const descDiv = document.createElement('div');
        descDiv.className = 'text-small color-fg-muted lh-condensed mt-1';
        descDiv.style.overflow = 'hidden';
        descDiv.style.textOverflow = 'ellipsis';
        descDiv.style.whiteSpace = 'nowrap';
        descDiv.textContent = interactable.title || '';

        // Third line: interaction info + time
        const metaDiv = document.createElement('div');
        metaDiv.className = 'text-small color-fg-muted lh-condensed mt-1';
        const interaction = formatInteraction(activity.interaction);
        const commenter = activity.commenter?.login ?? 'Someone';
        const timeAgo = formatRelativeTime(activity.occurredAt);
        metaDiv.textContent = `${commenter} ${interaction} · ${timeAgo}`;

        contentDiv.appendChild(titleDiv);
        contentDiv.appendChild(descDiv);
        contentDiv.appendChild(metaDiv);
      }

      item.appendChild(iconDiv);
      item.appendChild(contentDiv);
      list.appendChild(item);
    }

    // Remove bottom border from last item
    const lastItem = list.lastChild;
    if (lastItem) {
      lastItem.style.borderBottom = 'none';
    }

    body.replaceChildren(list);
    console.log('[Recent Activity] Rendered', activities.length, 'activities to DOM');
  }

  function formatInteraction(interaction) {
    if (typeof interaction !== 'string') {
      return 'did something';
    }

    return interaction
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/(^|\s)([a-z])/g, (_, space, letter) => space + letter.toUpperCase());
  }

  function formatRelativeTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const diff = date.getTime() - Date.now();
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const divisions = [
      { amount: 60, unit: 'second' },
      { amount: 60, unit: 'minute' },
      { amount: 24, unit: 'hour' },
      { amount: 7, unit: 'day' },
      { amount: 4.34524, unit: 'week' },
      { amount: 12, unit: 'month' },
      { amount: Number.POSITIVE_INFINITY, unit: 'year' }
    ];

    let duration = diff / 1000;

    for (const division of divisions) {
      if (Math.abs(duration) < division.amount) {
        return rtf.format(Math.round(duration), division.unit);
      }
      duration /= division.amount;
    }

    return rtf.format(Math.round(duration), 'year');
  }

  async function refresh(panel) {
    renderLoading(panel);
    try {
      console.log('[Recent Activity] Starting to fetch activities...');
      const activities = await fetchRecentActivityViaGraphQL();
      console.log('[Recent Activity] Activities fetched:', activities);
      renderActivities(panel, activities);
    } catch (error) {
      console.error('[Recent Activity] Failed to load recent activity', error);
      renderError(panel, error);
    }
  }

  function setupRefresh(panel) {
    const refreshBtn = panel.querySelector('#tm-refresh-recent-activity');

    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = 'true';
      refreshBtn.addEventListener('click', (event) => {
        event.preventDefault();
        refresh(panel);
      });
    }
  }

  async function mount() {
    console.log('[Recent Activity] mount() called');
    console.log('[Recent Activity] Current path:', location.pathname);
    console.log('[Recent Activity] Is dashboard?', isDashboard());
    if (!isDashboard()) {
      console.log('[Recent Activity] Not on dashboard, skipping');
      return;
    }

    try {
      console.log('[Recent Activity] Waiting for sidebar...');
      const sidebar = await waitForSidebar();
      console.log('[Recent Activity] Sidebar found:', sidebar);
      const panel = ensurePanel(sidebar);
      console.log('[Recent Activity] Panel created/found:', panel);
      setupRefresh(panel);
      console.log('[Recent Activity] Starting refresh...');
      refresh(panel);
    } catch (error) {
      console.error('[Recent Activity] Script failed to initialize', error);
    }
  }

  function handleRouteChange() {
    console.log('[Recent Activity] handleRouteChange triggered');
    const panel = document.getElementById(PANEL_ID);
    if (panel && !isDashboard()) {
      console.log('[Recent Activity] Removing panel (not on dashboard)');
      panel.remove();
      return;
    }
    mount();
  }

  console.log('[Recent Activity] Script loaded');
  document.addEventListener('turbo:load', handleRouteChange);
  document.addEventListener('pjax:end', handleRouteChange);
  document.addEventListener('DOMContentLoaded', handleRouteChange, { once: true });
  // Try to execute immediately
  if (document.readyState === 'loading') {
    console.log('[Recent Activity] Document still loading, waiting for DOMContentLoaded');
  } else {
    console.log('[Recent Activity] Document already loaded, calling mount immediately');
    mount();
  }
})();
