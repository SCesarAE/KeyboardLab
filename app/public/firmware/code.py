# KeyboardLab - firmware de diagnostico para Sofle (nice!nano / nRF52840)
# CircuitPython 9.x. Solo usa modulos integrados: no requiere librerias extra.
#
# Protocolo: JSON por lineas sobre el puerto serie USB (consola).
#   Dispositivo -> app: {"t": "hello" | "key" | "enc" | "hb" | "ack" | "err", ...}
#   App -> dispositivo: {"cmd": "hello" | "side" | "led" | "leds" | "vcc" | "bootloader", ...}
#
# Coordenadas "raw": las mismas en ambas mitades.
#   fila 0..4 (fila 4 = pulgares + tecla interior)
#   columna 0 = exterior ... columna 5 = interior

import json
import sys
import time

import board
import digitalio
import keypad
import microcontroller
import neopixel_write
import rotaryio
import supervisor

FW_NAME = "keyboardlab-diag"
FW_VERSION = "0.1.2"

# ---------------------------------------------------------------------------
# Pinout (tomado del shield sofle de ZMK, igual al Sofle Choc de QMK)
#   Pro Micro -> nice!nano
#   D5=P0.24 D6=P1.00 D7=P0.11 D8=P1.04 D9=P1.06            (filas)
#   D19=P0.02 D18=P1.15 D15=P1.13 D14=P1.11 D16=P0.10 D10=P0.09 (columnas)
#   D21=P0.31 D20=P0.29 (encoder)   D1/TX=P0.06 (datos LEDs)
# ---------------------------------------------------------------------------
ROW_PINS = (board.P0_24, board.P1_00, board.P0_11, board.P1_04, board.P1_06)
COL_PINS = (board.P0_02, board.P1_15, board.P1_13, board.P1_11, board.P0_10, board.P0_09)
ROW_NAMES = ("D5", "D6", "D7", "D8", "D9")
COL_NAMES = ("D19", "D18", "D15", "D14", "D16", "D10")
ENC_PIN_A = board.P0_31  # D21
ENC_PIN_B = board.P0_29  # D20
LED_PIN = board.P0_06    # D1 / TX
DEFAULT_LEDS = 29
MAX_BRIGHTNESS = 0.35    # tope de seguridad para el regulador del nice!nano

ROWS = len(ROW_PINS)
COLS = len(COL_PINS)

# ---------------------------------------------------------------------------
# Lado guardado en NVM (byte 0): 0 = desconocido, 1 = izquierda, 2 = derecha
# ---------------------------------------------------------------------------
SIDES = {0: "unknown", 1: "left", 2: "right"}


def read_side():
    try:
        return SIDES.get(microcontroller.nvm[0], "unknown")
    except Exception:
        return "unknown"


def write_side(name):
    code = {"left": 1, "right": 2}.get(name, 0)
    try:
        microcontroller.nvm[0] = code
    except Exception:
        pass
    return SIDES[code]


def send(obj):
    # print() agrega "\r\n"; la app separa por lineas
    print(json.dumps(obj))


# ---------------------------------------------------------------------------
# Hardware
# ---------------------------------------------------------------------------
# VCC externo (alimenta LEDs y OLED).
# nice!nano v2 y clones: P0.13 en ALTO = VCC encendido (en ZMK: ext-power ACTIVE_HIGH).
# Ojo: CircuitPython llama a este pin "VCC_OFF", pero en la v2 la logica es la inversa.
vcc = digitalio.DigitalInOut(board.VCC_OFF)
vcc.switch_to_output(value=True)
time.sleep(0.05)

status_led = digitalio.DigitalInOut(board.LED)
status_led.switch_to_output(value=False)

# Diodos col2row: la corriente va de columna a fila -> columnas son anodos
matrix = keypad.KeyMatrix(
    row_pins=ROW_PINS,
    column_pins=COL_PINS,
    columns_to_anodes=True,
    interval=0.002,
    max_events=128,
)

try:
    encoder = rotaryio.IncrementalEncoder(ENC_PIN_A, ENC_PIN_B)
    has_encoder = True
except Exception as e:  # pin ocupado o sin encoder soldado
    encoder = None
    has_encoder = False
    send({"t": "err", "msg": "encoder: " + str(e)})

led_pin = digitalio.DigitalInOut(LED_PIN)
led_pin.direction = digitalio.Direction.OUTPUT
led_count = DEFAULT_LEDS
led_buf = bytearray(led_count * 3)

# Estado de la animacion de LEDs
led_mode = "off"
led_rgb = (0, 255, 255)
led_index = 0
led_brightness = 0.15
anim_step = 0
anim_last = 0.0


def clamp_brightness(value):
    try:
        value = float(value)
    except Exception:
        return led_brightness
    return max(0.0, min(MAX_BRIGHTNESS, value))


def set_pixel(i, rgb):
    r, g, b = rgb
    k = led_brightness
    base = i * 3
    # SK6812 Mini-E: orden GRB
    led_buf[base] = int(g * k)
    led_buf[base + 1] = int(r * k)
    led_buf[base + 2] = int(b * k)


def fill(rgb):
    for i in range(led_count):
        set_pixel(i, rgb)


def wheel(pos):
    pos = pos % 255
    if pos < 85:
        return (255 - pos * 3, pos * 3, 0)
    if pos < 170:
        pos -= 85
        return (0, 255 - pos * 3, pos * 3)
    pos -= 170
    return (pos * 3, 0, 255 - pos * 3)


def render_leds(now):
    global anim_step, anim_last
    if led_mode in ("off", "all", "one"):
        return False
    if now - anim_last < 0.04:
        return False
    anim_last = now
    anim_step += 1
    if led_mode == "chase":
        fill((0, 0, 0))
        set_pixel(anim_step % led_count, led_rgb)
    elif led_mode == "rainbow":
        for i in range(led_count):
            set_pixel(i, wheel(anim_step * 3 + i * 255 // max(1, led_count)))
    return True


def apply_static_leds():
    fill((0, 0, 0))
    if led_mode == "all":
        fill(led_rgb)
    elif led_mode == "one" and 0 <= led_index < led_count:
        set_pixel(led_index, led_rgb)
    neopixel_write.neopixel_write(led_pin, led_buf)


def hello():
    send({
        "t": "hello",
        "fw": FW_NAME,
        "v": FW_VERSION,
        "board": "nice!nano",
        "side": read_side(),
        "rows": ROWS,
        "cols": COLS,
        "rowPins": ROW_NAMES,
        "colPins": COL_NAMES,
        "enc": has_encoder,
        "leds": led_count,
        "maxBr": MAX_BRIGHTNESS,
        "vcc": vcc.value,
    })


def handle(msg):
    global led_mode, led_rgb, led_index, led_brightness, led_count, led_buf
    cmd = msg.get("cmd")
    if cmd == "hello":
        hello()
    elif cmd == "ping":
        send({"t": "ack", "cmd": "ping"})
    elif cmd == "side":
        send({"t": "ack", "cmd": "side", "side": write_side(msg.get("v", ""))})
    elif cmd == "bootloader":
        # Reinicia directo al bootloader UF2 (aparece la unidad NICENANO), sin doble tap
        send({"t": "ack", "cmd": "bootloader"})
        time.sleep(0.2)
        microcontroller.on_next_reset(microcontroller.RunMode.UF2)
        microcontroller.reset()
    elif cmd == "vcc":
        vcc.value = bool(msg.get("on", True))
        time.sleep(0.05)
        apply_static_leds()
        send({"t": "ack", "cmd": "vcc", "on": vcc.value})
    elif cmd == "leds":
        n = int(msg.get("n", DEFAULT_LEDS))
        led_count = max(1, min(64, n))
        led_buf = bytearray(led_count * 3)
        apply_static_leds()
        send({"t": "ack", "cmd": "leds", "n": led_count})
    elif cmd == "led":
        led_mode = msg.get("mode", "off")
        rgb = msg.get("rgb")
        if rgb and len(rgb) == 3:
            led_rgb = (int(rgb[0]) & 255, int(rgb[1]) & 255, int(rgb[2]) & 255)
        if "i" in msg:
            led_index = int(msg["i"])
        if "br" in msg:
            led_brightness = clamp_brightness(msg["br"])
        apply_static_leds()
        send({"t": "ack", "cmd": "led", "mode": led_mode, "br": led_brightness})
    else:
        send({"t": "err", "msg": "comando desconocido: " + str(cmd)})


# ---------------------------------------------------------------------------
# Bucle principal
# ---------------------------------------------------------------------------
rx = ""
event = keypad.Event()
last_pos = encoder.position if has_encoder else 0
last_hb = time.monotonic()
boot_ms = supervisor.ticks_ms()

apply_static_leds()
hello()
was_connected = supervisor.runtime.serial_connected

while True:
    now = time.monotonic()

    # 1) Matriz
    while matrix.events.get_into(event):
        row, col = divmod(event.key_number, COLS)
        status_led.value = event.pressed
        send({
            "t": "key",
            "r": row,
            "c": col,
            "p": 1 if event.pressed else 0,
            "ms": supervisor.ticks_ms(),
        })
    if matrix.events.overflowed:
        matrix.events.clear()
        send({"t": "err", "msg": "cola de eventos llena"})

    # 2) Encoder
    if has_encoder:
        pos = encoder.position
        if pos != last_pos:
            send({"t": "enc", "d": 1 if pos > last_pos else -1, "pos": pos})
            last_pos = pos

    # 3) Comandos desde la app (lectura no bloqueante)
    n = supervisor.runtime.serial_bytes_available
    if n:
        rx += sys.stdin.read(n)
        while "\n" in rx:
            line, rx = rx.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                handle(json.loads(line))
            except Exception as e:
                send({"t": "err", "msg": str(e)})
        if len(rx) > 512:
            rx = ""

    # 4) LEDs animados
    if render_leds(now):
        neopixel_write.neopixel_write(led_pin, led_buf)

    # 5) Saludo cuando la app abre el puerto
    connected = supervisor.runtime.serial_connected
    if connected and not was_connected:
        hello()
    was_connected = connected

    # 6) Latido cada 2 s
    if now - last_hb > 2.0:
        last_hb = now
        send({"t": "hb", "up": supervisor.ticks_ms() - boot_ms})
