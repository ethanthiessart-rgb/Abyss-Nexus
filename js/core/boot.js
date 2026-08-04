'use strict';

(() => {
  const bootScreen = document.querySelector('#boot-screen');
  const loginScreen = document.querySelector('#login-screen');
  const progress = document.querySelector('#boot-progress');
  const percent = document.querySelector('#boot-percent');
  const message = document.querySelector('#boot-message');
  const stepLabel = document.querySelector('#boot-step');
  const skipButton = document.querySelector('#skip-intro');

  const steps = [
    { at: 12, code: 'CORE_INIT', text: 'Initialisation du noyau...' },
    { at: 30, code: 'MODULE_LOAD', text: 'Chargement des modules...' },
    { at: 49, code: 'DB_LINK', text: 'Connexion à la base de données...' },
    { at: 67, code: 'SECURITY_CHECK', text: 'Vérification de l’intégrité...' },
    { at: 84, code: 'PERMISSION_SYNC', text: 'Synchronisation des permissions...' },
    { at: 100, code: 'SYSTEM_READY', text: 'SYSTÈME OPÉRATIONNEL' }
  ];

  let value = 0;
  let timer;
  let completed = false;

  function setProgress(nextValue) {
    value = Math.min(100, nextValue);
    progress.style.width = `${value}%`;
    percent.textContent = `${value}%`;
    const current = [...steps].reverse().find((step) => value >= step.at) || steps[0];
    message.textContent = current.text;
    stepLabel.textContent = current.code;
  }

  function finishBoot() {
    if (completed) return;
    completed = true;
    clearInterval(timer);
    setProgress(100);
    window.setTimeout(() => {
      bootScreen.classList.add('is-hidden');
      loginScreen.classList.remove('is-hidden');
      loginScreen.setAttribute('aria-hidden', 'false');
      document.querySelector('#matricule')?.focus();
    }, 650);
  }

  function startBoot() {
    timer = window.setInterval(() => {
      const increment = Math.max(1, Math.round(Math.random() * 7));
      setProgress(value + increment);
      if (value >= 100) finishBoot();
    }, 145);
  }

  skipButton.addEventListener('click', finishBoot);
  startBoot();
})();
