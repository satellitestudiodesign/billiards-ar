export const en = {
  ambiguous: 'Similar fit for two sizes — pick your table size',
  autoHint: 'Point your phone at the pool table and hold steady while it locks on.',
  close: 'Close',
  debugLink: 'debug table view',
  desktopPrefix: 'Desktop? Try the ',
  detecting: 'Detecting table…',
  detectTable: 'Detect table',
  enterAR: 'Enter AR',
  enterManually: 'Enter corners manually',
  exitAR: 'Exit AR',
  fit: 'Fit: {size} table, corner error {cm} cm',
  fitHigh: ' — high, consider redoing',
  intro: 'Point your phone at a pool table, tap its four corners, and watch training drills play out on the real table.',
  looksRight: 'Looks right',
  manualHint: 'Aim the ring at corner {n} of 4 of the playing surface (where the cushion noses meet) and tap the screen. Go around the table in order.',
  notSupported: 'WebXR AR is not available in this browser. Use Chrome on Android. (iOS Safari has no WebXR yet.)',
  notTable: "That doesn't look like a table ({err}) — tap the 4 corners again",
  play: '▶ Play shot',
  redoCorners: 'Redo corners',
  replay: '↺ Replay',
  reRegister: 'Re-register',
  resetBalls: 'Reset balls',
  title: 'AR Billiards Trainer',
  undoCorner: 'Undo corner',
}

export const es: typeof en = {
  ambiguous: 'Ajuste similar para dos tamaños — elige el tamaño de tu mesa',
  autoHint: 'Apunta tu teléfono a la mesa de billar y mantenlo firme mientras se fija.',
  close: 'Cerrar',
  debugLink: 'vista de mesa de depuración',
  desktopPrefix: '¿En escritorio? Prueba la ',
  detecting: 'Detectando mesa…',
  detectTable: 'Detectar mesa',
  enterAR: 'Entrar en AR',
  enterManually: 'Introducir esquinas manualmente',
  exitAR: 'Salir de AR',
  fit: 'Ajuste: mesa {size}, error de esquina {cm} cm',
  fitHigh: ' — alto, considera rehacerlo',
  intro: 'Apunta tu teléfono a una mesa de billar, toca sus cuatro esquinas y observa cómo se ejecutan ejercicios de entrenamiento sobre la mesa real.',
  looksRight: 'Se ve bien',
  manualHint: 'Apunta el anillo a la esquina {n} de 4 de la superficie de juego (donde se encuentran las bandas) y toca la pantalla. Recorre la mesa en orden.',
  notSupported: 'WebXR AR no está disponible en este navegador. Usa Chrome en Android. (Safari en iOS aún no tiene WebXR.)',
  notTable: 'Eso no parece una mesa ({err}) — toca las 4 esquinas de nuevo',
  play: '▶ Ejecutar tiro',
  redoCorners: 'Rehacer esquinas',
  replay: '↺ Repetir',
  reRegister: 'Volver a registrar',
  resetBalls: 'Reiniciar bolas',
  title: 'Entrenador de Billar AR',
  undoCorner: 'Deshacer esquina',
}

export type DrillText = Record<string, { name: string; description: string }>

export const drillEn: DrillText = {
  stop: {
    name: 'Stop shot',
    description: 'Pot the 1 in the corner; the cue ball should stop dead on contact.',
  },
  draw: {
    name: 'Draw shot',
    description: 'Pot the 1 in the corner; heavy backspin draws the cue ball back.',
  },
  'cut-corner': {
    name: 'Cut to corner',
    description: 'Cut the object ball into the far corner pocket.',
  },
  '9ball-break': {
    name: '9-ball break',
    description: 'Full-speed break into a diamond rack from the head string.',
  },
  '9ball-break-other': {
    name: '9-ball break (other side)',
    description: 'Same break from one ball off the opposite side rail (mirrored in y).',
  },
}

export const drillEs: DrillText = {
  stop: {
    name: 'Tiro de parada',
    description: 'Mete la 1 en la esquina; la bola blanca debe detenerse en seco al contacto.',
  },
  draw: {
    name: 'Tiro con retroceso',
    description: 'Mete la 1 en la esquina; el efecto bajo fuerte hace retroceder la bola blanca.',
  },
  'cut-corner': {
    name: 'Corte a la esquina',
    description: 'Corta la bola objetivo hacia la tronera de la esquina lejana.',
  },
  '9ball-break': {
    name: 'Saque de bola 9',
    description: 'Saque a máxima potencia contra un rombo desde la línea de cabecera.',
  },
  '9ball-break-other': {
    name: 'Saque de bola 9 (otro lado)',
    description:
      'Mismo saque desde una bola fuera de la banda lateral opuesta (reflejado en y).',
  },
}
