# KeyboardLab

Laboratorio web todo en uno para teclados ZMK. Primer objetivo: un **Sofle Choc** inalámbrico con **nice!nano (nRF52840)**.

> Fase 1 · Diagnóstico de matriz, encoder y LEDs, con un modelo 3D del teclado que se ilumina en vivo.

## Cómo funciona

```
┌──────────────┐  Web Serial (JSON por líneas)  ┌──────────────────────────────┐
│  KeyboardLab │ ◄────────────────────────────► │ nice!nano + CircuitPython     │
│  React + R3F │                                │ firmware/diag/code.py         │
└──────────────┘                                └──────────────────────────────┘
```

1. Flasheas un **firmware de diagnóstico** (CircuitPython, un solo archivo) en cada mitad.
2. La app reporta **fila y columna en crudo** de cada switch: si una tecla nunca enciende, sabes exactamente qué switch, diodo o pin del header revisar.
3. Pruebas el **encoder** en ambos sentidos y los **LEDs por tecla** (todos, uno a uno, persecución, arcoíris), con el brillo limitado por seguridad.
4. Cuando todo está verde, vuelves a ZMK (`settings_reset` y luego `sofle_left` / `sofle_right`).

## Uso rápido

1. Descarga CircuitPython para nice!nano: <https://circuitpython.org/board/nice_nano/>
2. Doble tap al reset → unidad `NICENANO` → copia el `.uf2` de CircuitPython.
3. En la unidad `CIRCUITPY`, copia [`firmware/diag/code.py`](firmware/diag/code.py).
4. Abre la app en **Chrome o Edge**, pulsa **Conectar mitad (USB)** y asigna el lado.

Sin hardware a la mano: botón **Modo demo** (teclado de la PC o clic en las teclas 3D).

## Pinout usado (Sofle / Sofle Choc)

| Señal | Pro Micro | nice!nano |
|---|---|---|
| Filas 0–4 | D5, D6, D7, D8, D9 | P0.24, P1.00, P0.11, P1.04, P1.06 |
| Columnas 0–5 (exterior → interior) | D19, D18, D15, D14, D16, D10 | P0.02, P1.15, P1.13, P1.11, P0.10, P0.09 |
| Encoder A / B | D21 / D20 | P0.31 / P0.29 |
| LEDs (SK6812 Mini-E, 29 por lado) | D1 (TX) | P0.06 |
| OLED I2C SDA / SCL | D2 / D3 | P0.17 / P0.20 |

Diodos `col2row`. Fuente: shield `sofle` de ZMK y `sofle_choc` de QMK.

## Desarrollo

```bash
cd app
npm install
npm run dev      # http://localhost:5173/KeyboardLab/
npm run build
```

Stack: Vite + React + TypeScript + React Three Fiber + drei + postprocessing + zustand.

El acceso al hardware pasa por la interfaz `DeviceAdapter` (`app/src/lib/device/types.ts`). Hoy hay dos implementaciones (Web Serial y demo); la versión de escritorio (Tauri) agregará una tercera sin tocar la UI.

## Protocolo

Dispositivo → app: `hello`, `key {r,c,p,ms}`, `enc {d,pos}`, `hb`, `ack`, `err`
App → dispositivo: `hello`, `ping`, `side {v}`, `leds {n}`, `led {mode,rgb,i,br}`

Ver `app/src/lib/protocol.ts` y `firmware/diag/code.py`.

## Roadmap

- [x] Fase 1: diagnóstico de matriz + encoder + LEDs, modelo 3D
- [ ] Fase 2: OLED (simulador 128x32, envío a la pantalla real, importar GIF)
- [ ] Fase 3: estudio de animaciones de LEDs
- [x] Fase 4: flash asistido de UF2 (pestaña Flash)
- [ ] Fase 5: editor de keymap (importa `keymap.json` de QMK) + build en GitHub Actions
- [ ] Escritorio con Tauri
