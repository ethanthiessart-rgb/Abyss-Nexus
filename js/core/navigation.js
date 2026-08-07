'use strict';

(() => {
  const NAVIGATION = [
    { href: '/dashboard', label: 'Tableau de bord', permission: null }
  ];

  async function json(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Erreur serveur.');
    }

    return data;
  }

  function applyPreferences(settings = {}) {
    document.documentElement.dataset.theme =
      settings.theme || 'abyss-blue';

    document.body.classList.toggle(
      'no-animations',
      settings.animationsEnabled === false
    );

    document.body.classList.toggle(
      'no-glow',
      settings.glowEnabled === false
    );

    window.AbyssNexusSettings = settings;
  }

  function renderSidebar(user) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const permissions = Array.isArray(user.permissions)
      ? user.permissions
      : [];

    const currentPath = location.pathname;

    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <img src="/assets/logos/abyss-nexus-logo.png"
             alt="Logo Abyss Nexus">
        <div>
          <strong>ABYSS NEXUS</strong>
          <span>Staff Management System</span>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="Navigation principale">
        ${NAVIGATION
          .filter((item) =>
            !item.permission || permissions.includes(item.permission)
          )
          .map((item) => `
            <a class="nav-item ${
              currentPath === item.href ? 'is-active' : ''
            }" href="${item.href}">
              ${item.label}
            </a>
          `)
          .join('')}
      </nav>

      <div class="sidebar-footer">
        <span>Core v1.0</span>
      </div>
    `;
  }

  function injectSessionActionStyles() {
    if (document.querySelector('#global-session-action-styles')) return;

    const style = document.createElement('style');
    style.id = 'global-session-action-styles';
    style.textContent = `
      .global-session-actions {
        display: flex;
        align-items: center;
        gap: 9px;
        margin-left: auto;
        flex: 0 0 auto;
      }

      .global-top-lock,
      .global-top-logout {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 13px;
        border-radius: 10px;
        color: #ffffff;
        font-weight: 700;
        font-size: .78rem;
        white-space: nowrap;
        cursor: pointer;
      }

      .global-top-lock {
        border: 1px solid rgba(132, 184, 224, .38);
        background: rgba(15, 29, 43, .92);
      }

      .global-top-lock:hover {
        border-color: #4aacec;
        background: rgba(38, 132, 194, .15);
      }

      .global-top-logout {
        border: 1px solid rgba(255, 76, 101, .58);
        background: rgba(107, 19, 34, .18);
        color: #ff8193;
      }

      .global-top-logout:hover {
        background: rgba(255, 64, 91, .16);
        color: #ffafba;
      }

      @media (max-width: 1050px) {
        .global-top-lock span,
        .global-top-logout span {
          display: none;
        }

        .global-top-lock,
        .global-top-logout {
          width: 42px;
          padding: 0;
          font-size: 1rem;
        }
      }

      @media (max-width: 720px) {
        .global-session-actions {
          order: 20;
          width: 100%;
          margin-left: 0;
          justify-content: flex-end;
        }

        .topbar {
          flex-wrap: wrap;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function renderTopSessionActions() {
    const topbar = document.querySelector('.topbar');
    if (!topbar || topbar.querySelector('.global-session-actions')) return;

    injectSessionActionStyles();

    const actions = document.createElement('div');
    actions.className = 'global-session-actions';
    actions.innerHTML = `
      <button class="global-top-lock" type="button"
              title="Verrouiller la session">
        🔒 <span>Verrouiller la session</span>
      </button>

      <button class="global-top-logout" type="button"
              title="Se déconnecter">
        ↪ <span>Se déconnecter</span>
      </button>
    `;

    const notificationButton =
      topbar.querySelector('.notification-button, [class*="notification"]');
    const profile =
      topbar.querySelector('.profile-menu, .user-menu, [class*="profile"]');

    const reference = notificationButton || profile;

    if (reference?.parentElement === topbar) {
      topbar.insertBefore(actions, reference);
    } else {
      topbar.appendChild(actions);
    }

    actions
      .querySelector('.global-top-lock')
      ?.addEventListener('click', () => {
        window.dispatchEvent(
          new CustomEvent('abyss-lock-session')
        );
      });

    actions
      .querySelector('.global-top-logout')
      ?.addEventListener('click', async () => {
        try {
          const data = await json('/api/auth/logout', {
            method: 'POST'
          });

          location.assign(data.redirect || '/');
        } catch {
          location.assign('/');
        }
      });
  }

  (async () => {
    try {
      const account = await json('/api/account/settings');
      applyPreferences(account.settings);
      renderSidebar(account.user);
      renderTopSessionActions();
    } catch (error) {
      console.error('Navigation Abyss Nexus :', error);
      location.assign('/');
    }
  })();
})();
