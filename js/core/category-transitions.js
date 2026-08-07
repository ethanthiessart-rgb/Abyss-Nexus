'use strict';

(() => {
  const ROUTE_THEMES = [
    {
      test: /\/(personnel|employees|evaluations)(\/|$)/,
      theme: 'personnel',
      kicker: 'STAFF REGISTRY',
      title: 'REGISTRE DU PERSONNEL',
      messages: [
        'Vérification du dossier utilisateur...',
        'Synchronisation des profils staff...',
        'Registre du personnel prêt.'
      ]
    },
    {
      test: /\/(sanctions-advanced|discipline|reports-advanced|reports)(\/|$)/,
      theme: 'discipline',
      kicker: 'RESTRICTED RECORDS',
      title: 'DOSSIERS DISCIPLINAIRES',
      messages: [
        'Contrôle du niveau d’autorisation...',
        'Ouverture des dossiers protégés...',
        'Accès autorisé.'
      ]
    },
    {
      test: /\/(documents|document-library|archives)(\/|$)/,
      theme: 'archives',
      kicker: 'ABYSS ARCHIVES',
      title: 'ARCHIVES DOCUMENTAIRES',
      messages: [
        'Connexion au serveur documentaire...',
        'Déchiffrement des index...',
        'Archives synchronisées.'
      ]
    },
    {
      test: /\/(maintenance|system|backups|global-settings|settings)(\/|$)/,
      theme: 'system',
      kicker: 'SYSTEM CONTROL',
      title: '> INITIALISATION DU CENTRE SYSTÈME',
      messages: [
        '> Services............. ONLINE',
        '> Base de données...... ONLINE',
        '> Centre système prêt.'
      ]
    },
    {
      test: /\/(direction-dashboard|permissions|admin-center|departments|audit)(\/|$)/,
      theme: 'direction',
      kicker: 'LEVEL AUTHORIZATION',
      title: 'ACCÈS DIRECTION',
      messages: [
        'Vérification du matricule...',
        'Vérification des permissions...',
        'Niveau Direction confirmé.'
      ]
    },
    {
      test: /\/(mail|chat|announcements|communication-center|notifications|realtime-notifications)(\/|$)/,
      theme: 'communication',
      kicker: 'COMMUNICATION NETWORK',
      title: 'RÉSEAU DE COMMUNICATION',
      messages: [
        'Établissement du canal sécurisé...',
        'Synchronisation des communications...',
        'Canal sécurisé ouvert.'
      ]
    },
    {
      test: /\/(planning|leave|career|training|statistics|analytics-center)(\/|$)/,
      theme: 'operations',
      kicker: 'OPERATIONS CENTER',
      title: 'CENTRE OPÉRATIONNEL',
      messages: [
        'Chargement des données opérationnelles...',
        'Synchronisation des informations...',
        'Module prêt.'
      ]
    }
  ];

  const DEFAULT_CONFIG = {
    theme: 'operations',
    kicker: 'ABYSS NEXUS',
    title: 'OUVERTURE DU MODULE',
    messages: [
      'Vérification de l’accès...',
      'Chargement du module...',
      'Accès autorisé.'
    ]
  };

  function getConfig(pathname) {
    return ROUTE_THEMES.find((entry) => entry.test.test(pathname)) || DEFAULT_CONFIG;
  }

  function createLayer(config) {
    const layer = document.createElement('div');
    layer.className = 'anx-transition-layer anx-corners';
    layer.dataset.theme = config.theme;
    layer.setAttribute('aria-live', 'polite');
    layer.setAttribute('aria-label', `Ouverture : ${config.title}`);

    layer.innerHTML = `
      <div class="anx-scanline"></div>
      ${config.theme === 'direction'
        ? '<div class="anx-gate-left"></div><div class="anx-gate-right"></div>'
        : ''}
      <section class="anx-transition-shell">
        <img class="anx-transition-logo"
             src="/assets/logos/abyss-nexus-logo.png"
             alt="">
        <p class="anx-transition-kicker">${config.kicker}</p>
        <h2 class="anx-transition-title">${config.title}</h2>
        <p class="anx-transition-status"></p>
        <div class="anx-progress" aria-hidden="true"><span></span></div>
      </section>
    `;

    document.body.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add('is-active'));

    if (config.theme === 'direction') {
      setTimeout(() => layer.classList.add('gate-open'), 620);
    }

    return layer;
  }

  function playMessages(layer, messages) {
    const status = layer.querySelector('.anx-transition-status');
    let index = 0;

    if (!status) return;

    status.textContent = messages[0] || '';

    const timer = setInterval(() => {
      index += 1;
      if (index >= messages.length) {
        clearInterval(timer);
        return;
      }
      status.textContent = messages[index];
    }, 330);
  }

  function shouldHandleLink(link, event) {
    if (!link || event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target && link.target !== '_self') return false;
    if (link.hasAttribute('download')) return false;

    let url;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return false;
    }

    if (url.origin !== location.origin) return false;
    if (url.pathname === location.pathname && url.hash) return false;
    if (url.pathname === '/dashboard' || url.pathname === '/') return false;

    return true;
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!shouldHandleLink(link, event)) return;

    const url = new URL(link.href, location.href);
    const config = getConfig(url.pathname);

    event.preventDefault();

    const layer = createLayer(config);
    playMessages(layer, config.messages);

    const delay = config.theme === 'direction' ? 1280 : 1120;

    setTimeout(() => {
      location.assign(url.href);
    }, delay);
  }, true);
})();
