'use strict';

window.ABYSS_QUOTES = [
  "La discipline protège ceux qui respectent la mission.",
  "Chaque rapport renforce la mémoire de l’organisation.",
  "La confiance se construit par les actes.",
  "Une équipe unie résiste aux situations les plus difficiles.",
  "Observer, comprendre, agir.",
  "La rigueur d’aujourd’hui garantit la sécurité de demain.",
  "Le professionnalisme commence là où l’improvisation s’arrête.",
  "Une information claire vaut mieux qu’une décision précipitée.",
  "Protéger Abyss, c’est aussi protéger ceux qui le font vivre.",
  "La constance transforme une équipe en institution.",
  "La responsabilité accompagne chaque niveau d’autorisation.",
  "Les détails négligés deviennent les incidents de demain."
];

window.getAbyssQuoteOfTheDay = function getAbyssQuoteOfTheDay() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / 86400000);
  return window.ABYSS_QUOTES[day % window.ABYSS_QUOTES.length];
};
