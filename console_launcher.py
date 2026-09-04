import hashlib
import json
import os
import platform
import plistlib
import random
import re
import subprocess
import sys
import time
import tkinter as tk
from tkinter import simpledialog, messagebox, filedialog

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
ICON_CACHE_DIR = os.path.join(ASSETS_DIR, 'app_icons')
APPS_PATH = os.path.join(BASE_DIR, 'apps.json')
SETTINGS_PATH = os.path.join(BASE_DIR, 'settings.json')

DEFAULT_THEME_COLOR = '#0e6cc4'

TILE_W = 150
TILE_H = 88
TILE_HOVER_W = 172
TILE_HOVER_H = 103
TILE_GAP = 20
TILE_RADIUS = 12
ICON_TARGET = 52
ICON_HOVER_TARGET = 66

WINDOW_W, WINDOW_H = 960, 600
HEADER_H = 75
BUBBLE_RESERVE_H = 74
TILE_BOTTOM_PAD = 14
CATEGORY_LIST_W = 240


def _launch_and_wait(path):
    """Run path and block until it's closed. Best-effort per platform."""
    system = platform.system()
    if system == 'Darwin':
        subprocess.Popen(['open', '-W', path]).wait()
    else:
        subprocess.Popen([path]).wait()


def run_relaunch_watcher(path):
    """Run as a detached helper process: wait for `path` to close, then
    start a fresh instance of this launcher. This is what lets the main
    window fully close while a game runs and reopen once it's done,
    without the launcher process babysitting the game itself."""
    try:
        _launch_and_wait(path)
    except OSError:
        pass
    subprocess.Popen([sys.executable, os.path.abspath(__file__)])


def load_icon_from_path(path, target=32):
    img = tk.PhotoImage(file=path)
    factor = max(1, round(img.width() / target))
    if factor > 1:
        img = img.subsample(factor, factor)
    return img


def load_icon(filename, target=32):
    return load_icon_from_path(os.path.join(ASSETS_DIR, filename), target)


def load_icon_pair(path, target=ICON_TARGET, hover_target=ICON_HOVER_TARGET):
    return load_icon_from_path(path, target), load_icon_from_path(path, hover_target)


def _hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))


def _rgb_to_hex(rgb):
    return '#{:02x}{:02x}{:02x}'.format(*(max(0, min(255, int(c))) for c in rgb))


def _lighten(hex_color, amount):
    r, g, b = _hex_to_rgb(hex_color)
    return _rgb_to_hex((r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount))


def _darken(hex_color, amount):
    r, g, b = _hex_to_rgb(hex_color)
    return _rgb_to_hex((r * (1 - amount), g * (1 - amount), b * (1 - amount)))


def _mix(hex_a, hex_b, t):
    ar, ag, ab = _hex_to_rgb(hex_a)
    br, bg, bb = _hex_to_rgb(hex_b)
    return _rgb_to_hex((ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t))


def _luminance(hex_color):
    r, g, b = (c / 255 for c in _hex_to_rgb(hex_color))
    return 0.299 * r + 0.587 * g + 0.114 * b


def _readable_fg(hex_color, light='#ffffff', dark='#20242a'):
    """Pick dark or light text/icon color depending on how light the given
    surface color is, rather than assuming chrome is always dark (or always
    light) and hardcoding one text color everywhere."""
    return dark if _luminance(hex_color) > 0.6 else light


def _rounded_rect(canvas, x0, y0, x1, y1, radius, **kwargs):
    """Draw a rounded rectangle as a smoothed polygon — plain Tk widgets can't
    have rounded corners, so every rounded shape in this UI (tiles, bubbles,
    glow rings) is a canvas polygon rather than a Frame."""
    r = max(0, min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
    points = [
        x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r,
        x1, y1 - r, x1, y1, x1 - r, y1, x0 + r, y1,
        x0, y1, x0, y1 - r, x0, y0 + r, x0, y0,
    ]
    return canvas.create_polygon(points, smooth=True, **kwargs)


def compute_theme(base_hex, overrides=None):
    """Derive the whole menu palette from a single chosen accent color, then
    let `overrides` (from Settings > Menu Color) replace individual parts —
    e.g. picking Glow/Tile independently instead of always taking whatever
    this auto-lighten/darken/mix math produces from the accent alone.

    One consistent Windows Media Center look: a near-black base, a bright
    accent-tinted glow color (the gradient's bright band and the ambient
    bokeh blobs), and dark glass tile chrome — recolorable across the whole
    hue range via the accent, but otherwise the same design regardless of
    what color is chosen.
    """
    theme = {
        'bg': _darken(base_hex, 0.85),
        'glow': _lighten(base_hex, 0.25),
        'tile': _mix(base_hex, '#10141c', 0.75),
        'tile_overlay': _mix(base_hex, '#10141c', 0.55),
    }
    if overrides:
        theme.update(overrides)
    return theme


def _draw_media_center(canvas, theme, w, h, **opts):
    """Windows Media Center's Start-screen backdrop: a smooth vertical
    gradient from a bright accent-tinted glow down to near-black (many thin
    bands, since plain Tk shapes can't gradient-fill), plus a handful of
    soft, oversized, blurred-looking glow blobs drifting low in the frame —
    the same ambient-bokeh technique the old Wii U pattern used, just
    larger/softer and tinted toward the glow color instead of the base."""
    bands = 20
    for i in range(bands):
        y0 = h * i / bands
        y1 = h * (i + 1) / bands
        color = _mix(theme['glow'], theme['bg'], i / (bands - 1))
        canvas.create_rectangle(0, y0, w, y1 + 1, fill=color, outline='', **opts)

    rng = random.Random(7)
    for _ in range(9):
        r = (0.12 + rng.random() * 0.16) * max(w, h)
        cx = rng.random() * w
        cy = h * (0.55 + rng.random() * 0.45)
        fade = 0.55 + rng.random() * 0.35
        color = _mix(theme['glow'], theme['bg'], fade)
        canvas.create_oval(cx - r, cy - r, cx + r, cy + r, fill=color, outline='', **opts)


def _slug_for(path):
    digest = hashlib.sha1(path.encode('utf-8')).hexdigest()[:10]
    base = re.sub(r'[^A-Za-z0-9_-]+', '_', os.path.basename(path.rstrip('/')))
    return '{}_{}'.format(base, digest)


def extract_app_icon(app_path):
    """Best-effort icon extraction. Returns a PNG path on success, None otherwise.

    Only implemented for macOS .app bundles (via Info.plist + the built-in
    `sips` tool). Windows/Linux fall back to the letter-icon placeholder.
    """
    if platform.system() != 'Darwin' or not app_path.endswith('.app'):
        return None

    resources_dir = os.path.join(app_path, 'Contents', 'Resources')
    icns_path = None

    plist_path = os.path.join(app_path, 'Contents', 'Info.plist')
    if os.path.exists(plist_path):
        try:
            with open(plist_path, 'rb') as f:
                info = plistlib.load(f)
            icon_file = info.get('CFBundleIconFile')
        except Exception:
            icon_file = None
        if icon_file:
            if not icon_file.endswith('.icns'):
                icon_file += '.icns'
            candidate = os.path.join(resources_dir, icon_file)
            if os.path.exists(candidate):
                icns_path = candidate

    if icns_path is None and os.path.isdir(resources_dir):
        for fname in os.listdir(resources_dir):
            if fname.lower().endswith('.icns'):
                icns_path = os.path.join(resources_dir, fname)
                break

    if icns_path is None:
        return None

    os.makedirs(ICON_CACHE_DIR, exist_ok=True)
    dest_path = os.path.join(ICON_CACHE_DIR, _slug_for(app_path) + '.png')
    try:
        subprocess.run(
            ['sips', '-s', 'format', 'png', icns_path, '--out', dest_path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return dest_path if os.path.exists(dest_path) else None


class AppEntry:
    def __init__(self, name, path, icon=None, icon_hover=None, icon_path=None):
        self.name = name
        self.path = path
        self.icon = icon
        self.icon_hover = icon_hover
        self.icon_path = icon_path


class KeyboardNav:
    """Left/Right to move focus, Enter/Space to activate, Escape to go back.

    This is what makes the UI usable from a controller: any controller-to-
    keyboard mapper (Steam Input, DS4Windows, OS-level remapping, etc.) maps
    D-pad/stick to arrow keys and a face button to Enter, and the app just
    works — no raw gamepad/joystick library needed.
    """

    def __init__(self, frame, on_escape=None):
        self.frame = frame
        self.on_escape = on_escape
        self.items = []
        self.index = 0

    def add(self, focus_fn, unfocus_fn, activate_fn):
        self.items.append((focus_fn, unfocus_fn, activate_fn))

    def finish(self):
        if not self.items:
            return
        self.items[0][0]()
        self.frame.bind('<Left>', lambda _e: self._move(-1))
        self.frame.bind('<Right>', lambda _e: self._move(1))
        self.frame.bind('<Return>', lambda _e: self._activate())
        self.frame.bind('<KP_Enter>', lambda _e: self._activate())
        self.frame.bind('<space>', lambda _e: self._activate())
        self.frame.bind('<Escape>', lambda _e: self.on_escape() if self.on_escape else None)
        self.frame.focus_set()

    def _move(self, delta):
        self.items[self.index][1]()
        self.index = (self.index + delta) % len(self.items)
        self.items[self.index][0]()

    def _activate(self):
        self.items[self.index][2]()


class ConsoleLauncher:
    def __init__(self, root):
        self.root = root
        self.root.title('Console Launcher')
        self.root.resizable(True, True)
        self.root.minsize(640, 420)

        self.window_w, self.window_h = WINDOW_W, WINDOW_H
        self.scale = 1.0
        self._resize_after_id = None
        self._pending_size = None

        self._place_window(self.window_w, self.window_h)

        icon_path = os.path.join(BASE_DIR, 'pictures', 'app_icon.png')
        if os.path.exists(icon_path):
            self.icon_image = tk.PhotoImage(file=icon_path)
            self.root.iconphoto(False, self.icon_image)

        self.icons = {}
        self.plus_icon = self.plus_icon_hover = None

        self.apps = []
        self.theme_color = DEFAULT_THEME_COLOR
        self.custom_colors = {}
        self.theme = compute_theme(self.theme_color, self.custom_colors)
        self.mc_category = 0
        self.current_screen = MediaCenterMenu

        self._load_apps()
        self._load_settings()
        self._refresh_icons()

        self.container = tk.Frame(self.root)
        self.container.pack(fill='both', expand=True)

        self.render()

        self.root.bind('<Configure>', self._on_root_configure)

    def px(self, base):
        return max(1, round(base * self.scale))

    def pt(self, base):
        return max(8, round(base * self.scale))

    def _compute_scale(self, width, height):
        return max(0.55, min(3.0, min(width / WINDOW_W, height / WINDOW_H)))

    def _refresh_icons(self):
        target, hover_target = self.px(ICON_TARGET), self.px(ICON_HOVER_TARGET)
        for entry in self.apps:
            if entry.icon_path and os.path.exists(entry.icon_path):
                try:
                    entry.icon, entry.icon_hover = load_icon_pair(entry.icon_path, target, hover_target)
                except tk.TclError:
                    entry.icon = entry.icon_hover = None
        self.plus_icon, self.plus_icon_hover = load_icon_pair(
            os.path.join(ASSETS_DIR, 'ps4_plus.png'), target, hover_target)
        self.icons['off'] = load_icon('ps4_off.png', self.px(24))

    def _on_root_configure(self, event):
        if event.widget is not self.root:
            return
        if (event.width, event.height) == (self.window_w, self.window_h):
            return
        self._pending_size = (event.width, event.height)
        if self._resize_after_id:
            self.root.after_cancel(self._resize_after_id)
        self._resize_after_id = self.root.after(150, self._apply_resize)

    def _apply_resize(self):
        self._resize_after_id = None
        self.window_w, self.window_h = self._pending_size
        new_scale = self._compute_scale(self.window_w, self.window_h)
        rescaled = new_scale != self.scale
        self.scale = new_scale
        if rescaled:
            self._refresh_icons()
        if self.current_screen is ColorChannelScreen:
            # This screen holds in-progress, un-Applied color edits in memory
            # (reseeded from app.theme on construction) — rebuilding it on
            # every resize tick would silently discard whatever the user was
            # dragging. It's plain pack()-based already, so it reflows fine
            # on its own without a rebuild.
            return
        self._show(self.current_screen)

    def _place_window(self, width, height):
        # Fixed screen position so the window (and its corner buttons) always
        # reopens in the same spot, including after the close/relaunch cycle
        # that happens when a game is launched.
        x = (self.root.winfo_screenwidth() - width) // 2
        y = (self.root.winfo_screenheight() - height) // 2
        self.root.geometry('{}x{}+{}+{}'.format(width, height, x, y))

    def _show(self, screen_cls):
        for widget in self.container.winfo_children():
            widget.destroy()
        screen_cls(self.container, self)
        self.current_screen = screen_cls

    def render(self):
        self._show(MediaCenterMenu)

    def open_manage_games_screen(self):
        self._show(RemoveGameScreen)

    def open_color_screen(self):
        self._show(ColorChannelScreen)

    def _save_apps(self):
        data = {
            'apps': [
                {'name': a.name, 'path': a.path, 'icon_path': a.icon_path}
                for a in self.apps
            ],
        }
        try:
            with open(APPS_PATH, 'w') as f:
                json.dump(data, f, indent=2)
        except OSError:
            pass

    def _load_apps(self):
        if not os.path.exists(APPS_PATH):
            return
        try:
            with open(APPS_PATH, 'r') as f:
                data = json.load(f)
        except (OSError, ValueError):
            return

        for item in data.get('apps', []):
            # Icons are loaded (at the current scale) by _refresh_icons(),
            # called right after this during startup — no need to load them
            # twice here.
            self.apps.append(AppEntry(item.get('name', ''), item.get('path', ''),
                                       icon_path=item.get('icon_path')))

    def _save_settings(self):
        data = {
            'theme_color': self.theme_color,
            'custom_colors': self.custom_colors,
        }
        try:
            with open(SETTINGS_PATH, 'w') as f:
                json.dump(data, f, indent=2)
        except OSError:
            pass

    def _load_settings(self):
        if not os.path.exists(SETTINGS_PATH):
            return
        try:
            with open(SETTINGS_PATH, 'r') as f:
                data = json.load(f)
        except (OSError, ValueError):
            return

        theme_color = data.get('theme_color')
        if theme_color:
            self.theme_color = theme_color

        custom_colors = data.get('custom_colors')
        if isinstance(custom_colors, dict):
            self.custom_colors = {
                key: value for key, value in custom_colors.items()
                if key in ('glow', 'tile') and isinstance(value, str)
                and re.fullmatch(r'#[0-9a-fA-F]{6}', value)
            }

        self.theme = compute_theme(self.theme_color, self.custom_colors)

    def add_app_dialog(self):
        path = filedialog.askopenfilename(
            title='Choose an application to add',
            initialdir=self._default_app_dir(),
            parent=self.root,
        )
        if not path:
            return
        default_name = os.path.splitext(os.path.basename(path.rstrip('/')))[0]
        name = simpledialog.askstring('New app', 'Name:', initialvalue=default_name, parent=self.root)
        if not name:
            return

        icon = None
        icon_hover = None
        icon_path = extract_app_icon(path)
        if icon_path:
            try:
                icon, icon_hover = load_icon_pair(icon_path, self.px(ICON_TARGET), self.px(ICON_HOVER_TARGET))
            except tk.TclError:
                icon = None
                icon_hover = None
                icon_path = None

        self.apps.append(AppEntry(name, path, icon=icon, icon_hover=icon_hover, icon_path=icon_path))
        self._save_apps()
        self.render()

    def remove_app(self, entry):
        if entry in self.apps:
            self.apps.remove(entry)
        if entry.icon_path and os.path.dirname(entry.icon_path) == ICON_CACHE_DIR:
            try:
                os.remove(entry.icon_path)
            except OSError:
                pass
        self._save_apps()
        self.open_manage_games_screen()

    @staticmethod
    def _default_app_dir():
        system = platform.system()
        if system == 'Darwin':
            return '/Applications'
        if system == 'Windows':
            return os.environ.get('ProgramFiles', 'C:\\')
        return os.path.expanduser('~')

    def apply_theme_parts(self, accent_hex, glow_hex, tile_hex):
        """Commit all the individually-tunable color parts at once (Menu
        Color's accent plus the glow and tile colors), rather than only ever
        deriving them automatically from a single base color."""
        self.theme_color = accent_hex
        self.custom_colors = {'glow': glow_hex, 'tile': tile_hex}
        self.theme = compute_theme(accent_hex, self.custom_colors)
        self._save_settings()
        self.render()

    def launch(self, app):
        path = (app.path or '').strip()
        if not path:
            return
        if not os.path.exists(path):
            messagebox.showerror('Launch failed', 'This app could not be found:\n{}'.format(path))
            return
        try:
            subprocess.Popen([sys.executable, os.path.abspath(__file__), '--relaunch-after', path])
        except OSError as exc:
            messagebox.showerror('Launch failed', str(exc))
            return
        self.quit()

    def quit(self):
        # A pending debounced resize (see _on_root_configure) must not be
        # allowed to fire after the root is destroyed — it would touch a
        # dead Tk interpreter and raise a TclError from inside the
        # scheduled after() callback.
        if self._resize_after_id:
            self.root.after_cancel(self._resize_after_id)
            self._resize_after_id = None
        self.root.destroy()


def _icon_for(entry):
    if entry.path == '__remove_game__':
        return '🗑'
    if entry.path == '__theme_color__':
        return '🎨'
    if entry.path == '__back__':
        return '←'
    return entry.name[:1].upper()


def _action_word(entry):
    if entry.path == '__back__':
        return 'Back'
    if entry.path == '__remove_game__':
        return 'Remove'
    if entry.path in ('__add__', '__theme_color__'):
        return 'Open'
    return 'Start'


def _wrap_two_lines(text):
    if ' ' not in text:
        return text
    words = text.split(' ')
    mid = len(words) // 2
    return ' '.join(words[:mid]) + '\n' + ' '.join(words[mid:])


def _measure_text(canvas, text, font):
    tmp = canvas.create_text(0, 0, text=text, font=font)
    bbox = canvas.bbox(tmp)
    canvas.delete(tmp)
    return (bbox[2] - bbox[0], bbox[3] - bbox[1]) if bbox else (0, 0)


def _draw_glass_pill(canvas, x0, y0, x1, y1, theme, app, tags, accent, glow_color=None):
    """A glossy capsule tinted with the user's own menu color — shadow, body,
    glass sheen on top, and (when hovered) a brighter glow ring plus a body
    that leans further into that accent color, so it's obvious which pill
    is focused rather than just carrying a thin outline."""
    radius = (y1 - y0) / 2
    if glow_color:
        for margin, fade in ((app.px(9), 0.85), (app.px(4), 0.5)):
            _rounded_rect(canvas, x0 - margin, y0 - margin, x1 + margin, y1 + margin,
                           radius + margin, fill=_mix(glow_color, theme['bg'], fade),
                           outline='', tags=tags)
    _rounded_rect(canvas, x0 + app.px(2), y0 + app.px(3), x1 + app.px(2), y1 + app.px(3), radius,
                   fill=_darken(theme['bg'], 0.45), outline='', tags=tags)
    body = _mix(theme['tile'], accent, 0.55 if glow_color else 0.3)
    _rounded_rect(canvas, x0, y0, x1, y1, radius, fill=body,
                   outline=glow_color if glow_color else '', width=3 if glow_color else 0, tags=tags)
    sheen = _mix(theme['tile_overlay'], '#ffffff', 0.3 if glow_color else 0.05)
    _rounded_rect(canvas, x0 + app.px(3), y0 + app.px(2), x1 - app.px(3), y0 + (y1 - y0) * 0.5,
                   radius * 0.8, fill=sheen, outline='', tags=tags)
    return _readable_fg(body)


def _make_tile(canvas, x_col, y_row, app, entry, action_word=_action_word):
    """Draw one glowing glass tile (shadow, rounded body, icon, hover glow
    ring and name bubble) directly onto the shared, already-decorated
    tile-strip canvas — not a separate widget. A separate opaque Canvas per
    tile would paint its own rectangular background over the pattern before
    the rounded shape got a chance to show through, hiding the rounding
    inside a bigger square of a near-identical color. Drawing straight onto
    the same canvas as the background means the rounded corners genuinely
    reveal the pattern behind them, and there's no nested-widget Enter/Leave
    to fight either — hover is resolved by build_tile_strip's single pointer
    hit-test instead.

    Returns a dict with the tile's hit-box and its on_enter/on_leave hooks.
    """
    theme = app.theme
    bg = theme['bg']
    tile_color = theme['tile']
    tile_fg = _readable_fg(tile_color)
    bubble_color = theme['tile_overlay']
    bubble_fg = _readable_fg(bubble_color)
    bubble_fg_muted = _mix(bubble_fg, bubble_color, 0.35)
    glow_color = app.theme_color

    col_w = app.px(TILE_HOVER_W)
    tile_top = y_row + app.px(BUBBLE_RESERVE_H)
    cx = x_col + col_w / 2
    tag = 'tile{}'.format(id(entry))
    tile_radius = app.px(TILE_RADIUS)

    def redraw(hover):
        canvas.delete(tag)
        w = app.px(TILE_HOVER_W) if hover else app.px(TILE_W)
        h = app.px(TILE_HOVER_H) if hover else app.px(TILE_H)
        x0, x1 = cx - w / 2, cx + w / 2
        y0, y1 = tile_top, tile_top + h

        if hover:
            for margin, fade in ((app.px(11), 0.8), (app.px(6), 0.5), (app.px(2), 0.15)):
                _rounded_rect(canvas, x0 - margin, y0 - margin, x1 + margin, y1 + margin,
                               tile_radius + margin, fill=_mix(glow_color, bg, fade),
                               outline='', tags=tag)

        _rounded_rect(canvas, x0 + app.px(3), y0 + app.px(4), x1 + app.px(3), y1 + app.px(4), tile_radius,
                       fill=_darken(bg, 0.35), outline='', tags=tag)
        _rounded_rect(canvas, x0, y0, x1, y1, tile_radius, fill=tile_color,
                       outline=glow_color if hover else '', width=2, tags=tag)

        cy = (y0 + y1) / 2
        if entry.icon is not None:
            canvas.create_image((cx, cy), image=(entry.icon_hover if hover else entry.icon), tags=tag)
        else:
            canvas.create_text((cx, cy), text=_icon_for(entry), fill=tile_fg,
                                font=('Helvetica', app.pt(38) if hover else app.pt(30)), tags=tag)
        return y0

    bubble_tag = tag + 'b'

    def show_bubble(tile_top_y):
        canvas.delete(bubble_tag)

        name_font = ('Helvetica', app.pt(11), 'bold')
        action_font = ('Helvetica', app.pt(9))
        name_text = entry.name
        name_w, name_h = _measure_text(canvas, name_text, name_font)
        if name_w > col_w - app.px(24):
            name_text = _wrap_two_lines(name_text)
            name_w, name_h = _measure_text(canvas, name_text, name_font)
        action_text = action_word(entry)
        action_w, action_h = _measure_text(canvas, action_text, action_font)

        bubble_w = min(col_w, max(app.px(80), max(name_w, action_w) + app.px(26)))
        bubble_h = name_h + action_h + app.px(20)
        by1 = tile_top_y - app.px(9)
        by0 = by1 - bubble_h
        bx0, bx1 = cx - bubble_w / 2, cx + bubble_w / 2

        _rounded_rect(canvas, bx0, by0, bx1, by1, app.px(12), fill=bubble_color, outline='', tags=bubble_tag)
        canvas.create_polygon(cx - app.px(7), by1 - app.px(1), cx + app.px(7), by1 - app.px(1),
                               cx, by1 + app.px(8), fill=bubble_color, outline='', tags=bubble_tag)
        canvas.create_text(cx, by0 + app.px(9) + name_h / 2, text=name_text,
                            fill=bubble_fg, font=name_font, justify='center', tags=bubble_tag)
        canvas.create_text(cx, by0 + app.px(13) + name_h + action_h / 2,
                            text=action_text, fill=bubble_fg_muted, font=action_font, tags=bubble_tag)

    def hide_bubble():
        canvas.delete(bubble_tag)

    def on_enter():
        top_y = redraw(True)
        show_bubble(top_y)

    def on_leave():
        redraw(False)
        hide_bubble()

    redraw(False)
    bbox = (x_col, y_row, x_col + col_w, y_row + _tile_row_height(app))
    return {'bbox': bbox, 'on_enter': on_enter, 'on_leave': on_leave}


def make_background_decorator(app):
    """The header strip and the tile row below it are drawn on two separate
    canvases, but both decorators paint the same full-window pattern (sized
    to the real, current window dimensions) and then shift it up by
    y_offset — so the header shows the pattern's top slice and the tile row
    picks up exactly where it left off, instead of each canvas independently
    rescaling the pattern into its own bounds and producing a visible seam."""
    def draw_background(canvas, y_offset=0):
        _draw_media_center(canvas, app.theme, app.window_w, app.window_h)
        if y_offset:
            canvas.move('all', 0, -y_offset)
    return draw_background


def build_header_canvas(parent, app, height=None):
    """A header row drawn on the same decorated background as the rest of the
    menu, so the chosen background style shows through the gaps between the
    header items instead of stopping at a flat strip."""
    if height is None:
        height = app.px(HEADER_H)
    bg = app.theme['bg']
    canvas = tk.Canvas(parent, bg=bg, height=height, highlightthickness=0)
    canvas.pack(fill='x', side='top', pady=(app.px(10), 0))
    make_background_decorator(app)(canvas)

    left = tk.Frame(canvas, bg=bg)
    canvas.create_window((15, height // 2), window=left, anchor='w')

    right = tk.Frame(canvas, bg=bg)
    right_id = canvas.create_window((0, height // 2), window=right, anchor='e')

    def reposition(event):
        canvas.coords(right_id, event.width - 15, height // 2)

    canvas.bind('<Configure>', reposition)
    return left, right


def build_title_header(parent, app, title):
    """The simple sub-screen header: a glass-pill title chip drawn directly
    on the decorated canvas, in the same 'menu chrome' material as the tiles
    and the main menu's HUD chips — used by every screen that just needs a
    back-arrow-adjacent title (Remove Game, Menu Color, etc)."""
    left, right = build_header_canvas(parent, app)
    canvas = left.master
    left.destroy()
    right.destroy()
    canvas.unbind('<Configure>')

    theme = app.theme
    cy = app.px(HEADER_H) / 2
    pill_h = app.px(40)
    pad = app.px(18)
    title_font = ('Helvetica', app.pt(16), 'bold')
    text_w, _text_h = _measure_text(canvas, title, title_font)
    x0, x1 = app.px(16), app.px(16) + pad + text_w + pad
    y0, y1 = cy - pill_h / 2, cy + pill_h / 2
    fg = _draw_glass_pill(canvas, x0, y0, x1, y1, theme, app, tags='hudtitle', accent=app.theme_color)
    canvas.create_text((x0 + x1) / 2, cy, text=title, fill=fg,
                        font=title_font, tags='hudtitle')
    return canvas


def _wire_hover_dispatch(canvas, hit_boxes, canvas_coords=False):
    """A single pointer hit-test drives hover/click for a list of
    (x0, y0, x1, y1, on_enter, on_leave, activate) hit-boxes on one canvas,
    instead of per-shape widget bindings — the shapes (tiles, HUD buttons)
    are canvas items, not separate windows, so there's nothing for Tk to
    bind Enter/Leave to individually. Shared by the tile strip and the
    header/bottom-bar HUD buttons instead of three near-identical copies of
    this dispatch logic. `canvas_coords` converts event coordinates through
    canvas.canvasx/canvasy first, for canvases that can scroll."""
    hover = {'item': None}

    def _hit(px, py):
        # Returns the matched hit_boxes entry itself (a stable tuple already
        # sitting in the caller's list), not a freshly-built subset tuple —
        # on_motion compares this by identity, and a newly-constructed tuple
        # would never `is` itself across calls, defeating that comparison
        # and re-triggering on_leave/on_enter on every pixel of movement.
        for box in hit_boxes:
            x0, y0, x1, y1 = box[:4]
            if x0 <= px <= x1 and y0 <= py <= y1:
                return box
        return None

    def _event_pos(event):
        if canvas_coords:
            return canvas.canvasx(event.x), canvas.canvasy(event.y)
        return event.x, event.y

    def on_motion(event):
        item = _hit(*_event_pos(event))
        if item is not hover['item']:
            if hover['item'] is not None:
                hover['item'][5]()
            hover['item'] = item
            if item is not None:
                item[4]()
        canvas.configure(cursor='hand2' if item is not None else '')

    def on_leave_canvas(_event=None):
        if hover['item'] is not None:
            hover['item'][5]()
            hover['item'] = None
        canvas.configure(cursor='')

    def on_click(event):
        item = _hit(*_event_pos(event))
        if item is not None:
            item[6]()

    canvas.bind('<Motion>', on_motion, add='+')
    canvas.bind('<Leave>', on_leave_canvas, add='+')
    canvas.bind('<Button-1>', on_click, add='+')


def _tile_row_height(app):
    return app.px(BUBBLE_RESERVE_H) + app.px(TILE_HOVER_H) + app.px(TILE_BOTTOM_PAD)


def build_tile_strip(parent, app, entries, on_activate, nav, decorate=None,
                      action_word=_action_word):
    # Tiles are drawn directly onto this one canvas (see _make_tile) rather
    # than packed into separate widgets, so the decorated background shows
    # through the gaps between tiles — and through their rounded corners —
    # instead of being hidden behind each tile's own opaque rectangle.
    # Entries form a single row that scrolls horizontally when there are
    # more than fit on screen.
    bg = app.theme['bg']
    outer = tk.Frame(parent, bg=bg)
    outer.pack(fill='both', expand=True, pady=(0, app.px(10)))

    canvas = tk.Canvas(outer, bg=bg, highlightthickness=0)

    col_width = app.px(TILE_HOVER_W)
    tile_gap = app.px(TILE_GAP)
    row_height = _tile_row_height(app)

    bar = tk.Scrollbar(outer, orient='horizontal', command=canvas.xview)
    canvas.configure(xscrollcommand=bar.set)
    canvas.pack(side='top', fill='both', expand=True)
    bar.pack(side='bottom', fill='x')

    if decorate:
        decorate(canvas, y_offset=app.px(HEADER_H))

    tiles = []
    x = tile_gap // 2
    for entry in entries:
        info = _make_tile(canvas, x, 0, app, entry, action_word)
        tiles.append((info, entry))
        x += col_width + tile_gap
        nav.add(info['on_enter'], info['on_leave'], lambda e=entry: on_activate(e))
    canvas.configure(scrollregion=(0, 0, x, row_height))

    hit_boxes = [
        (info['bbox'][0], info['bbox'][1], info['bbox'][2], info['bbox'][3],
         info['on_enter'], info['on_leave'], (lambda e=entry: on_activate(e)))
        for info, entry in tiles
    ]
    _wire_hover_dispatch(canvas, hit_boxes, canvas_coords=True)


MC_CATEGORIES = [
    ('games', 'Games'),
    ('settings', 'Settings'),
]


class MediaCenterMenu(tk.Frame):
    """The main screen: a Windows Media Center-style vertical list of
    category rows (Games, Settings) down the left side. Up/Down switches
    which category is focused; the focused row expands into a horizontal
    strip of large glowing tiles to its right (build_tile_strip's ordinary
    single-row scrolling mode, the same one Remove Game already uses),
    while the other row collapses to a plain label — matching how Media
    Center's own Start screen behaves. "Settings" plays the same role Media
    Center's own "Tasks" category does: a grab-bag of app-level actions
    rather than real content, shown the same way as any other category."""

    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)
        # KeyboardNav only ever handles Left/Right within the focused
        # category's strip — Up/Down (switching categories) is this
        # screen's own concern, bound separately below.
        self.nav = KeyboardNav(self)
        header_nav_items = self._build_header()
        self._build_body()
        for item in header_nav_items:
            self.nav.add(*item)
        self.nav.finish()
        self.bind('<Up>', lambda _e: self._switch_category(-1))
        self.bind('<Down>', lambda _e: self._switch_category(1))

    def _build_header(self):
        app = self.app
        theme = app.theme

        # build_header_canvas hands back a decorated canvas plus two empty
        # placeholder frames sized for a simple pack() layout; this screen's
        # header is drawn directly on that same canvas instead (fixed,
        # explicitly-computed positions for every button, right-to-left),
        # so nothing here depends on pack()'s flow layout or a <Configure>
        # reposition catching up after the fact. Media Center's own chrome
        # keeps this area almost empty (just the glowing sky), so all
        # that's left here is the clock plus power.
        left, right = build_header_canvas(self, app)
        canvas = left.master
        left.destroy()
        right.destroy()
        # build_header_canvas's own <Configure> handler repositions `right`,
        # which we just destroyed — drop it so a later Configure event can't
        # call canvas.coords() on that now-dead window item.
        canvas.unbind('<Configure>')

        cy = app.px(HEADER_H) / 2
        pill_h = app.px(40)

        canvas.update_idletasks()
        width = canvas.winfo_width()

        # Right-to-left: power sits at the far edge, with the clock further
        # left still.
        right_edge = width - app.px(16)
        button_specs = [
            {'icon': app.icons.get('off'), 'activate': app.quit},
        ]

        buttons = []
        for spec in button_specs:
            x1 = right_edge
            x0 = x1 - pill_h
            y0, y1 = cy - pill_h / 2, cy + pill_h / 2
            buttons.append((x0, y0, x1, y1, spec))
            right_edge = x0 - app.px(10)

        clock_text = time.strftime('%H:%M')
        clock_fg = _readable_fg(theme['bg'])
        self.clock_id = canvas.create_text(right_edge, cy, text=clock_text, fill=clock_fg,
                                            font=('Helvetica', app.pt(14), 'bold'), anchor='e')

        hit_boxes = []
        for x0, y0, x1, y1, spec in buttons:
            tag = 'hudbtn{}'.format(id(spec))

            def redraw(hover, x0=x0, y0=y0, x1=x1, y1=y1, spec=spec, tag=tag):
                canvas.delete(tag)
                fg = _draw_glass_pill(canvas, x0, y0, x1, y1, theme, app, tags=tag, accent=app.theme_color,
                                       glow_color=app.theme_color if hover else None)
                cx, cy_ = (x0 + x1) / 2, (y0 + y1) / 2
                icon = spec.get('icon')
                if icon is not None:
                    canvas.create_image((cx, cy_), image=icon, tags=tag)
                else:
                    canvas.create_text((cx, cy_), text=spec['glyph'], fill=fg,
                                        font=spec['font'], tags=tag)

            def on_enter(redraw=redraw):
                redraw(True)

            def on_leave(redraw=redraw):
                redraw(False)

            redraw(False)
            hit_boxes.append((x0, y0, x1, y1, on_enter, on_leave, spec['activate']))

        # Left/Right nav must walk the buttons in their actual left-to-right
        # screen order — not the right-to-left order they were positioned
        # in — otherwise Right moves focus to a button that's visually to
        # the left, and vice versa.
        nav_items = [box[4:] for box in sorted(hit_boxes, key=lambda b: b[0])]
        _wire_hover_dispatch(canvas, hit_boxes, canvas_coords=True)

        self.header_canvas = canvas
        self._tick_clock()

        return nav_items

    def _tick_clock(self):
        self.header_canvas.itemconfigure(self.clock_id, text=time.strftime('%H:%M'))
        self.after(1000, self._tick_clock)

    def _switch_category(self, delta):
        self.app.mc_category = (self.app.mc_category + delta) % len(MC_CATEGORIES)
        self.app.render()

    def _build_body(self):
        app = self.app
        theme = app.theme

        outer = tk.Frame(self, bg=theme['bg'])
        outer.pack(fill='both', expand=True)

        label_col = tk.Frame(outer, bg=theme['bg'], width=app.px(CATEGORY_LIST_W))
        label_col.pack(side='left', fill='y')
        label_col.pack_propagate(False)

        strip_area = tk.Frame(outer, bg=theme['bg'])
        strip_area.pack(side='left', fill='both', expand=True)

        dim_fg = _mix(_readable_fg(theme['bg']), theme['bg'], 0.55)
        for i, (key, label) in enumerate(MC_CATEGORIES):
            focused = i == app.mc_category
            font = ('Helvetica', app.pt(28 if focused else 18), 'bold' if focused else 'normal')
            lbl = tk.Label(label_col, text=label, font=font, fg=app.theme_color if focused else dim_fg,
                           bg=theme['bg'], anchor='w', cursor='hand2')
            lbl.pack(fill='x', padx=app.px(28), pady=app.px(16 if focused else 8))
            lbl.bind('<Button-1>', lambda _e=None, i=i: self._go_to_category(i))

        key, _label = MC_CATEGORIES[app.mc_category]
        entries = self._category_entries(key)
        build_tile_strip(strip_area, app, entries, self._activate, self.nav,
                          decorate=make_background_decorator(app))

    def _go_to_category(self, index):
        self.app.mc_category = index
        self.app.render()

    def _category_entries(self, key):
        app = self.app
        if key == 'games':
            return list(app.apps)
        return [
            AppEntry('Add Game', '__add__', icon=app.plus_icon, icon_hover=app.plus_icon_hover),
            AppEntry('Remove Game', '__remove_game__'),
            AppEntry('Menu Color', '__theme_color__'),
        ]

    def _activate(self, entry):
        key, _label = MC_CATEGORIES[self.app.mc_category]
        if key == 'games':
            self.app.launch(entry)
            return
        app = self.app
        if entry.path == '__add__':
            app.add_app_dialog()
        elif entry.path == '__remove_game__':
            app.open_manage_games_screen()
        elif entry.path == '__theme_color__':
            app.open_color_screen()


def _remove_action_word(entry):
    return 'Back' if entry.path == '__back__' else 'Remove'


class RemoveGameScreen(tk.Frame):
    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)
        self.nav = KeyboardNav(self, on_escape=self.app.render)
        self._build_header()
        self._build_tiles()
        self.nav.finish()

    def _build_header(self):
        build_title_header(self, self.app, 'Remove Game')

    def _build_tiles(self):
        entries = list(self.app.apps) + [AppEntry('Back', '__back__')]
        build_tile_strip(self, self.app, entries, self._activate, self.nav,
                          decorate=make_background_decorator(self.app),
                          action_word=_remove_action_word)

    def _activate(self, entry):
        if entry.path == '__back__':
            self.app.render()
            return
        if messagebox.askyesno(
            'Remove game', 'Remove "{}" from the launcher?'.format(entry.name), parent=self.app.root,
        ):
            self.app.remove_app(entry)


COLOR_PARTS = [
    ('accent', 'Menu Color'),
    ('glow', 'Glow'),
    ('tile', 'Tile'),
]


class ColorChannelScreen(tk.Frame):
    """R/G/B sliders for each individually-tunable color part (the overall
    menu accent, plus the glow and tile colors), adjusted with Up/Down to
    pick a row and Left/Right to change its value — the controller-friendly
    alternative to the native color panel, which is an OS dialog we have no
    ability to add keyboard/controller navigation to. Every control here
    also works with a plain mouse click or click-drag."""

    STEP = 8
    BAR_W = 260
    BAR_H = 22
    ROW_COUNT = 6  # Part tabs, Red, Green, Blue, Apply, Back

    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)

        self.values = {
            'accent': list(_hex_to_rgb(app.theme_color)),
            'glow': list(_hex_to_rgb(app.theme['glow'])),
            'tile': list(_hex_to_rgb(app.theme['tile'])),
        }
        self.part_index = 0
        self.index = 0
        self.rows = []
        self.tabs = []

        bg = app.theme['bg']
        self.fg = _readable_fg(bg)
        self.focus_color = app.theme_color
        build_title_header(self, app, 'Menu Color')

        body = tk.Frame(self, bg=bg)
        body.pack(fill='both', expand=True, padx=50, pady=10)

        tabs_row = tk.Frame(body, bg=bg)
        tabs_row.pack(pady=(0, 12))
        for key, label in COLOR_PARTS:
            tab = tk.Frame(tabs_row, bg=bg, highlightthickness=2, highlightbackground=bg, cursor='hand2')
            tab.pack(side='left', padx=6)
            tab_label = tk.Label(tab, text=label, bg=bg, fg=self.fg, font=('Helvetica', 11), padx=12, pady=6)
            tab_label.pack()
            self.tabs.append({'frame': tab, 'label': tab_label, 'key': key})
            self._bind_click(tab, lambda _e=None, k=key: self._select_part(k))

        self.preview = tk.Frame(body, width=140, height=140,
                                 highlightthickness=3, highlightbackground=bg)
        self.preview.pack(pady=(0, 20))
        self.preview.pack_propagate(False)

        for i, name in enumerate(('Red', 'Green', 'Blue')):
            row_frame = tk.Frame(body, bg=bg, highlightthickness=2, highlightbackground=bg, cursor='hand2')
            row_frame.pack(fill='x', pady=6, ipady=6)
            tk.Label(row_frame, text=name, bg=bg, fg=self.fg, font=('Helvetica', 12),
                     width=7, anchor='w').pack(side='left', padx=(10, 0))
            bar = tk.Canvas(row_frame, width=self.BAR_W, height=self.BAR_H, bg='#1a1a1a',
                             highlightthickness=0, cursor='hand2')
            bar.pack(side='left', padx=10)
            fill_id = bar.create_rectangle(0, 0, 0, self.BAR_H, fill='white', outline='')
            value_label = tk.Label(row_frame, text='0', bg=bg, fg=self.fg, font=('Helvetica', 12), width=4)
            value_label.pack(side='left')
            self.rows.append({'frame': row_frame, 'bar': bar, 'fill_id': fill_id, 'value_label': value_label})

            self._bind_click(row_frame, lambda _e=None, i=i: self._select_row(i))

            def _set_from_bar(event, i=i):
                self.index = i
                x = max(0, min(self.BAR_W, event.x))
                self.values[self.current_part][i] = round(x / self.BAR_W * 255)
                self._refresh()

            bar.bind('<Button-1>', _set_from_bar)
            bar.bind('<B1-Motion>', _set_from_bar)

        actions = tk.Frame(body, bg=bg)
        actions.pack(pady=(20, 0))
        self.apply_frame = tk.Frame(actions, bg=bg, highlightthickness=2, highlightbackground=bg, cursor='hand2')
        self.apply_frame.pack(side='left', padx=10)
        tk.Label(self.apply_frame, text='Apply', bg=bg, fg=self.fg, font=('Helvetica', 13),
                 padx=16, pady=6).pack()
        self._bind_click(self.apply_frame, lambda _e=None: self._apply())

        self.back_frame = tk.Frame(actions, bg=bg, highlightthickness=2, highlightbackground=bg, cursor='hand2')
        self.back_frame.pack(side='left', padx=10)
        tk.Label(self.back_frame, text='Back', bg=bg, fg=self.fg, font=('Helvetica', 13),
                 padx=16, pady=6).pack()
        self._bind_click(self.back_frame, lambda _e=None: self.app.render())

        self.bind('<Up>', lambda _e: self._move(-1))
        self.bind('<Down>', lambda _e: self._move(1))
        self.bind('<Left>', lambda _e: self._adjust(-self.STEP))
        self.bind('<Right>', lambda _e: self._adjust(self.STEP))
        self.bind('<Return>', lambda _e: self._activate())
        self.bind('<KP_Enter>', lambda _e: self._activate())
        self.bind('<space>', lambda _e: self._activate())
        self.bind('<Escape>', lambda _e: self.app.render())
        self.focus_set()

        self._refresh()

    @staticmethod
    def _bind_click(widget, handler):
        # A Frame containing a Label is two widgets; bind the click on both
        # so it fires no matter which one the pointer is actually over.
        widget.bind('<Button-1>', handler)
        for child in widget.winfo_children():
            child.bind('<Button-1>', handler)

    @property
    def current_part(self):
        return COLOR_PARTS[self.part_index][0]

    def _select_part(self, key):
        self.part_index = [k for k, _ in COLOR_PARTS].index(key)
        self.index = 0
        self._refresh()

    def _select_row(self, i):
        # Nav index 0 is the part tabs; the RGB rows start at 1, so a click
        # on visual row i (0=Red, 1=Green, 2=Blue) must land on index i+1 —
        # using i directly here mis-selected the row above the one clicked.
        self.index = i + 1
        self._refresh()

    def _move(self, delta):
        self.index = (self.index + delta) % self.ROW_COUNT
        self._refresh()

    def _adjust(self, delta):
        if self.index == 0:
            self.part_index = (self.part_index + (1 if delta > 0 else -1)) % len(COLOR_PARTS)
            self._refresh()
        elif 1 <= self.index <= 3:
            channel = self.index - 1
            values = self.values[self.current_part]
            values[channel] = max(0, min(255, values[channel] + delta))
            self._refresh()

    def _activate(self):
        if self.index == 4:
            self._apply()
        elif self.index == 5:
            self.app.render()

    def _apply(self):
        self.app.apply_theme_parts(
            _rgb_to_hex(tuple(self.values['accent'])),
            _rgb_to_hex(tuple(self.values['glow'])),
            _rgb_to_hex(tuple(self.values['tile'])),
        )

    def _refresh(self):
        bg = self.app.theme['bg']
        values = self.values[self.current_part]
        hex_color = _rgb_to_hex(tuple(values))
        self.preview.configure(bg=hex_color)

        for i in range(len(COLOR_PARTS)):
            is_active = self.part_index == i
            is_focused = self.index == 0 and is_active
            tab_bg = self.app.theme_color if is_active else bg
            self.tabs[i]['frame'].configure(
                bg=tab_bg, highlightbackground=self.focus_color if is_focused else tab_bg)
            self.tabs[i]['label'].configure(bg=tab_bg, fg=_readable_fg(tab_bg) if is_active else self.fg)

        for i, row in enumerate(self.rows):
            value = values[i]
            row['value_label'].configure(text=str(value))
            width = int(self.BAR_W * value / 255)
            row['bar'].coords(row['fill_id'], 0, 0, width, self.BAR_H)
            row['frame'].configure(highlightbackground=self.focus_color if self.index == i + 1 else bg)
        self.apply_frame.configure(highlightbackground=self.focus_color if self.index == 4 else bg)
        self.back_frame.configure(highlightbackground=self.focus_color if self.index == 5 else bg)


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == '--relaunch-after':
        run_relaunch_watcher(sys.argv[2])
        return
    root = tk.Tk()
    ConsoleLauncher(root)
    root.mainloop()


if __name__ == '__main__':
    main()
