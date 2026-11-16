# KeyboardLab - firmware de diagnostico para Sofle (nice!nano / nRF52840)
# CircuitPython 9/10. Solo usa modulos integrados: no requiere librerias extra.
#
# Protocolo: JSON por lineas sobre el puerto serie USB (consola).
#   Dispositivo -> app: {"t": "hello" | "key" | "enc" | "hb" | "ack" | "err", ...}
#   App -> dispositivo: {"cmd": "hello" | "side" | "led" | "leds" | "vcc" | "bootloader" | "oled", ...}
#
# Coordenadas "raw": las mismas en ambas mitades.
#   fila 0..4 (fila 4 = pulgares + tecla interior)
#   columna 0 = exterior ... columna 5 = interior

import binascii
import json
import sys
import time

import board
import busio
import digitalio
import keypad
import microcontroller
import neopixel_write
import rotaryio
import supervisor

# CircuitPython 10 escribe una barra de estado en la consola serie que ensucia el JSON
try:
    supervisor.status_bar.console = False
except Exception:
    pass

FW_NAME = "keyboardlab-diag"
FW_VERSION = "0.2.1"  # [KL-DIAG-HELD] antes 0.2.0; sube para confirmar que se cargo esta version

# ---------------------------------------------------------------------------
# Pinout (tomado del shield sofle de ZMK, igual al Sofle Choc de QMK)
#   Pro Micro -> nice!nano
#   D5=P0.24 D6=P1.00 D7=P0.11 D8=P1.04 D9=P1.06            (filas)
#   D19=P0.02 D18=P1.15 D15=P1.13 D14=P1.11 D16=P0.10 D10=P0.09 (columnas)
#   D21=P0.31 D20=P0.29 (encoder)   D1/TX=P0.06 (datos LEDs)
#   D2/SDA=P0.17 D3/SCL=P0.20 (OLED SSD1306 128x32, I2C 0x3C)
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
OLED_W = 128
OLED_H = 32
OLED_BYTES = OLED_W * OLED_H // 8  # 512: 4 paginas de 128 columnas

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


# ---------------------------------------------------------------------------
# OLED SSD1306 128x32 por I2C (driver minimo, sin librerias)
# ---------------------------------------------------------------------------
OLED_INIT = (
    0xAE,        # apagar
    0xD5, 0x80,  # reloj
    0xA8, 0x1F,  # multiplex 32 filas
    0xD3, 0x00,  # offset
    0x40,        # linea de inicio 0
    0x8D, 0x14,  # bomba de carga
    0x20, 0x00,  # direccionamiento horizontal
    0xA1,        # segment remap (igual que ZMK)
    0xC8,        # escaneo COM invertido (igual que ZMK)
    0xDA, 0x02,  # pines COM secuenciales (128x32)
    0x81, 0x8F,  # contraste
    0xD9, 0x22,  # precarga (igual que ZMK)
    0xDB, 0x40,  # VCOMH
    0xA4,        # mostrar RAM
    0xA6,        # normal (no invertido)
    0xAF,        # encender
)

i2c = None
oled_addr = None
oled_buf = bytearray(OLED_BYTES)


def oled_cmd(*cmds):
    for c in cmds:
        i2c.writeto(oled_addr, bytes((0x00, c)))


def oled_init():
    global i2c, oled_addr
    try:
        if i2c is None:
            i2c = busio.I2C(board.P0_20, board.P0_17, frequency=400000)
        while not i2c.try_lock():
            pass
        try:
            found = [a for a in i2c.scan() if a in (0x3C, 0x3D)]
            oled_addr = found[0] if found else None
            if oled_addr is not None:
                oled_cmd(*OLED_INIT)
        finally:
            i2c.unlock()
    except Exception as e:
        oled_addr = None
        send({"t": "err", "msg": "oled: " + str(e)})
    return oled_addr is not None


def oled_show():
    if oled_addr is None:
        return False
    while not i2c.try_lock():
        pass
    try:
        oled_cmd(0x21, 0, OLED_W - 1, 0x22, 0, OLED_H // 8 - 1)
        chunk = bytearray(33)
        chunk[0] = 0x40
        mv = memoryview(oled_buf)
        for i in range(0, OLED_BYTES, 32):
            chunk[1:33] = mv[i:i + 32]
            i2c.writeto(oled_addr, chunk)
    finally:
        i2c.unlock()
    return True


def oled_simple(*cmds):
    if oled_addr is None:
        return
    while not i2c.try_lock():
        pass
    try:
        oled_cmd(*cmds)
    finally:
        i2c.unlock()


def oled_pattern(name):
    for i in range(OLED_BYTES):
        col = i % OLED_W
        if name == "fill":
            v = 0xFF
        elif name == "checker":
            v = 0xAA if (col // 1) % 2 else 0x55
        elif name == "border":
            page = i // OLED_W
            v = 0
            if col in (0, OLED_W - 1):
                v = 0xFF
            else:
                if page == 0:
                    v |= 0x01
                if page == OLED_H // 8 - 1:
                    v |= 0x80
        else:
            v = 0
        oled_buf[i] = v


def handle_oled(msg):
    op = msg.get("op", "")
    if op == "init":
        ok = oled_init()
        if ok:
            oled_pattern("border")
            oled_show()
        send({"t": "ack", "cmd": "oled", "op": op, "ok": ok, "addr": oled_addr})
        return
    if oled_addr is None and not oled_init():
        send({"t": "ack", "cmd": "oled", "op": op, "ok": False})
        return
    if op == "frame":
        data = binascii.a2b_base64(msg.get("b64", ""))
        if len(data) != OLED_BYTES:
            send({"t": "err", "msg": "oled: frame de %d bytes" % len(data)})
            return
        oled_buf[:] = data
        oled_show()
        if msg.get("ack"):
            send({"t": "ack", "cmd": "oled", "op": op, "ok": True})
        return
    if op in ("fill", "clear", "checker", "border"):
        oled_pattern(op)
        oled_show()
    elif op == "contrast":
        oled_simple(0x81, int(msg.get("v", 0x8F)) & 0xFF)
    elif op == "invert":
        oled_simple(0xA7 if msg.get("v") else 0xA6)
    elif op == "flip":
        oled_simple(*((0xA0, 0xC0) if msg.get("v") else (0xA1, 0xC8)))
    elif op == "power":
        oled_simple(0xAF if msg.get("v", True) else 0xAE)
    send({"t": "ack", "cmd": "oled", "op": op, "ok": True})


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
        "oled": oled_addr is not None,
    })


def handle(msg):
    global led_mode, led_rgb, led_index, led_brightness, led_count, led_buf
    cmd = msg.get("cmd")
    if cmd == "hello":
        hello()
        # [KL-DIAG-HELD] inicio: re-emite las teclas que ya estan presionadas
        # (puentes soldados o switches atascados). Su evento de "presionar" salio
        # al arrancar, antes de que la app abriera el puerto, y se perdio.
        # keypad.reset() da todo por liberado y genera eventos nuevos para lo que siga cerrado.
        # Para quitarlo: borra estas lineas hasta "[KL-DIAG-HELD] fin".
        matrix.reset()
        # [KL-DIAG-HELD] fin
    elif cmd == "ping":
        send({"t": "ack", "cmd": "ping"})
    elif cmd == "side":
        send({"t": "ack", "cmd": "side", "side": write_side(msg.get("v", ""))})
    elif cmd == "oled":
        handle_oled(msg)
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
time.sleep(0.1)  # la OLED necesita unos ms despues de encender VCC
if oled_init():
    oled_pattern("border")
    oled_show()
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
            # Tolera basura antes/despues del JSON (Ctrl-D, escapes de terminal)
            a = line.find("{")
            b = line.rfind("}")
            if a < 0 or b < a:
                continue
            line = line[a:b + 1]
            try:
                handle(json.loads(line))
            except Exception as e:
                send({"t": "err", "msg": str(e)})
        if len(rx) > 4096:
            rx = ""

    # 4) LEDs animados
    if render_leds(now):
        neopixel_write.neopixel_write(led_pin, led_buf)

    # 5) Saludo cuando la app abre el puerto
    connected = supervisor.runtime.serial_connected
    if connected and not was_connected:
        hello()
        matrix.reset()  # [KL-DIAG-HELD] mismo motivo que en el comando "hello"
    was_connected = connected

    # 6) Latido cada 2 s
    if now - last_hb > 2.0:
        last_hb = now
        send({"t": "hb", "up": supervisor.ticks_ms() - boot_ms})
