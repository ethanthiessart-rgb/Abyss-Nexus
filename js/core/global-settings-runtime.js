'use strict';

(() => {
  const MODULE_ROUTES = {
    chat: ['/chat'],
    realtimeNotifications: ['/realtime-notifications'],
    advancedReports: ['/reports-advanced'],
    advancedSanctions: ['/sanctions-advanced'],
    training: ['/training'],
    evaluations: ['/evaluations'],
    planning: ['/planning'],
    career: ['/career'],
    archives: ['/archives'],
    statistics: ['/statistics']
  };

  async function loadPublicSettings() {
    const response = await fetch('/api/global-settings/public', {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) return null;
    return response.json();
  }

  function applyBranding(data) {
    const branding = data.branding || {};
    const general = data.general || {};

    document.documentElement.style.setProperty(
      '--global-primary',
      branding.primaryColor || '#238fd3'
    );
    document.documentElement.style.setProperty(
      '--global-secondary',
      branding.secondaryColor || '#796cff'
    );

    const title = document.querySelector('.sidebar-brand strong');
    const subtitle = document.querySelector('.sidebar-brand span');
    const logo = document.querySelector('.sidebar-brand img');

    if (title) title.textContent = branding.organizationName || 'ABYSS NEXUS';
    if (subtitle) subtitle.textContent = branding.portalSubtitle || 'Staff Management System';
    if (logo && branding.logoUrl) logo.src = branding.logoUrl;

    document.querySelectorAll('.sidebar-footer span').forEach((item) => {
      if (item.textContent.includes('Core')) {
        item.textContent = `${general.coreName || 'Core'} ${general.versionLabel || 'v1.0'}`;
      }
    });
  }

  function applyModuleVisibility(data) {
    const modules = data.modules || {};

    for (const [moduleKey, routes] of Object.entries(MODULE_ROUTES)) {
      if (modules[moduleKey] !== false) continue;

      routes.forEach((route) => {
        document.querySelectorAll(`a[href="${route}"]`)
          .forEach((link) => link.remove());
      });
    }
  }

  loadPublicSettings()
    .then((data) => {
      if (!data?.ok) return;
      applyBranding(data);
      applyModuleVisibility(data);
      window.AbyssGlobalSettings = data;
    })
    .catch(() => {});
})();
