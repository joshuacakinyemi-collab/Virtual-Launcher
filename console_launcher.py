import hashlib
import json
import math
import os
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import time
import tkinter as tk
from tkinter import simpledialog, messagebox, filedialog, colorchooser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
AUDIO_DIR = os.path.join(ASSETS_DIR, 'audio')
ICON_CACHE_DIR = os.path.join(ASSETS_DIR, 'app_icons')
APPS_PATH = os.path.join(BASE_DIR, 'apps.json')
SETTINGS_PATH = os.path.join(BASE_DIR, 'settings.json')
STARTUP_SOUND_PATH = os.path.join(AUDIO_DIR, 'ps4_navigate.mp3')
NAV_SOUND_PATH = os.path.join(AUDIO_DIR, '12. Src19 Se Log Cursor.mp3')

DEFAULT_THEME_COLOR = '#0e6cc4'

TILE_SIZE = 120
TILE_HOVER_W = 145
TILE_HOVER_H = 158
TILE_GAP = 20
ICON_TARGET = 70
ICON_HOVER_TARGET = 96


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


_sound_player_cmd = None
_sound_processes = []


def _get_sound_player():
    global _sound_player_cmd
    if _sound_player_cmd is not None:
        return _sound_player_cmd
    system = platform.system()
    if system == 'Darwin':
        candidates = [['afplay']]
    elif system == 'Windows':
        candidates = []
    else:
        candidates = [['mpg123', '-q'], ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet']]
    _sound_player_cmd = []
    for cmd in candidates:
        if shutil.which(cmd[0]):
            _sound_player_cmd = cmd
            break
    return _sound_player_cmd


def play_sound(path):
    if not path or not os.path.exists(path):
        return None
    player = _get_sound_player()
    if not player:
        return None
    global _sound_processes
    _sound_processes = [p for p in _sound_processes if p.poll() is None]
    try:
        proc = subprocess.Popen(player + [path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return None
    _sound_processes.append(proc)
    return proc


def play_nav_sound(app):
    if not app.muted:
        play_sound(NAV_SOUND_PATH)


def play_startup_sound(app):
    if not app.muted:
        play_sound(STARTUP_SOUND_PATH)


def load_icon_from_path(path, target=32):
    img = tk.PhotoImage(file=path)
    factor = max(1, round(img.width() / target))
    if factor > 1:
        img = img.subsample(factor, factor)
    return img


def load_icon(filename, target=32):
    return load_icon_from_path(os.path.join(ASSETS_DIR, filename), target)


def load_icon_pair(path):
    return load_icon_from_path(path, ICON_TARGET), load_icon_from_path(path, ICON_HOVER_TARGET)


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


def compute_theme(base_hex):
    """Derive the whole menu palette from a single chosen color."""
    return {
        'bg': base_hex,
        'tile': _lighten(base_hex, 0.15),
        'tile_overlay': _lighten(base_hex, 0.35),
        'wave1': _lighten(base_hex, 0.15),
        'wave2': _darken(base_hex, 0.3),
    }


def _draw_waves(canvas, theme, w, h):
    # Layered diagonal ribbons sweeping from the bottom-left corner, echoing
    # the PS4 reference's flowing wave motif instead of plain stacked circles.
    colors = [theme['wave2'], theme['wave1'], theme['wave2'], theme['wave1']]
    for i in range(4):
        t = i / 3
        x0 = -w * (0.55 - t * 0.25)
        y0 = h * (0.05 + t * 0.18)
        x1 = w * (0.85 - t * 0.18)
        y1 = h * (1.05 + t * 0.35)
        canvas.create_oval(x0, y0, x1, y1, fill=colors[i], outline='')


def _draw_rings(canvas, theme, w, h):
    cx, cy = w * 0.16, h * 0.68
    max_r = max(w, h) * 0.95
    rings = 9
    colors = [theme['wave2'], theme['wave1']]
    for i in range(rings):
        r = max_r * (rings - i) / rings
        canvas.create_oval(cx - r, cy - r, cx + r, cy + r, fill=colors[i % 2], outline='')


def _draw_diagonal(canvas, theme, w, h):
    colors = [theme['wave1'], theme['wave2']]
    band = w * 0.09
    skew = h * 0.9
    x = -skew - band
    i = 0
    while x < w + band:
        canvas.create_polygon(
            x, h + 10, x + skew, -10, x + skew + band, -10, x + band, h + 10,
            fill=colors[i % 2], outline='',
        )
        x += band
        i += 1


def _draw_sunburst(canvas, theme, w, h):
    # Radiates from a corner rather than dead-center, and reaches well past
    # the canvas edge so the spokes read as a burst instead of a flat wheel.
    cx, cy = w * 0.16, h * 0.68
    outer = max(w, h) * 1.3
    spokes = 32
    colors = [theme['wave1'], theme['wave2']]
    for i in range(spokes):
        a0 = 2 * math.pi * i / spokes
        a1 = 2 * math.pi * (i + 1) / spokes
        x0, y0 = cx + outer * math.cos(a0), cy + outer * math.sin(a0)
        x1, y1 = cx + outer * math.cos(a1), cy + outer * math.sin(a1)
        canvas.create_polygon(cx, cy, x0, y0, x1, y1, fill=colors[i % 2], outline='')


def _draw_halftone(canvas, theme, w, h):
    cx, cy = w * 0.78, h * 0.22
    spacing = max(w, h) * 0.055
    max_radius = spacing * 0.5
    colors = [theme['wave1'], theme['wave2']]
    row = 0
    y = -spacing
    while y < h + spacing:
        col = 0
        x = -spacing
        while x < w + spacing:
            dist = math.hypot(x - cx, y - cy)
            radius = max_radius - dist / (max(w, h) * 0.11)
            if radius > max_radius * 0.12:
                canvas.create_oval(x - radius, y - radius, x + radius, y + radius,
                                    fill=colors[(row + col) % 2], outline='')
            x += spacing
            col += 1
        y += spacing
        row += 1


BACKGROUND_STYLE_ORDER = ['waves', 'rings', 'diagonal', 'sunburst', 'halftone']
BACKGROUND_STYLE_LABELS = {
    'waves': 'Waves', 'rings': 'Rings', 'diagonal': 'Diagonal',
    'sunburst': 'Sunburst', 'halftone': 'Halftone',
}
BACKGROUND_STYLES = {
    'waves': _draw_waves, 'rings': _draw_rings, 'diagonal': _draw_diagonal,
    'sunburst': _draw_sunburst, 'halftone': _draw_halftone,
}


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
    def __init__(self, name, path, icon=None, icon_hover=None, icon_path=None, preview_style=None):
        self.name = name
        self.path = path
        self.icon = icon
        self.icon_hover = icon_hover
        self.icon_path = icon_path
        self.preview_style = preview_style


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
        self.root.resizable(False, False)
        self._place_window(960, 600)

        icon_path = os.path.join(BASE_DIR, 'pictures', 'inkling.png')
        if os.path.exists(icon_path):
            self.icon_image = tk.PhotoImage(file=icon_path)
            self.root.iconphoto(False, self.icon_image)

        self.icons = {
            'notification': load_icon('ps4_info.png', 22),
            'user': load_icon('ps4_user.png', 26),
            'trophy': load_icon('ps4_trophy.png', 22),
            'friends': load_icon('ps4_friends.png', 22),
            'off': load_icon('ps4_off.png', 24),
        }
        self.plus_icon, self.plus_icon_hover = load_icon_pair(os.path.join(ASSETS_DIR, 'ps4_plus.png'))

        self.apps = []
        self.background_sound_path = None
        self.background_sound_proc = None
        self.recent_sounds = []
        self.muted = False
        self.theme_color = DEFAULT_THEME_COLOR
        self.theme = compute_theme(self.theme_color)
        self.background_style = 'waves'
        self._bg_sound_token = 0

        self._load_apps()
        self._load_settings()

        self.container = tk.Frame(self.root)
        self.container.pack(fill='both', expand=True)

        self.render()
        play_startup_sound(self)

    def _place_window(self, width, height):
        # Fixed screen position so the window (and its corner buttons) always
        # reopens in the same spot, including after the close/relaunch cycle
        # that happens when a game is launched.
        x = (self.root.winfo_screenwidth() - width) // 2
        y = (self.root.winfo_screenheight() - height) // 2
        self.root.geometry('{}x{}+{}+{}'.format(width, height, x, y))

    def render(self):
        for widget in self.container.winfo_children():
            widget.destroy()
        PS4Menu(self.container, self)

    def open_settings(self):
        for widget in self.container.winfo_children():
            widget.destroy()
        SettingsScreen(self.container, self)

    def open_background_style_screen(self):
        for widget in self.container.winfo_children():
            widget.destroy()
        BackgroundStyleScreen(self.container, self)

    def open_music_screen(self):
        for widget in self.container.winfo_children():
            widget.destroy()
        MusicScreen(self.container, self)

    def open_manage_games_screen(self):
        for widget in self.container.winfo_children():
            widget.destroy()
        RemoveGameScreen(self.container, self)

    def open_color_screen(self):
        for widget in self.container.winfo_children():
            widget.destroy()
        ColorChannelScreen(self.container, self)

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
            icon = None
            icon_hover = None
            icon_path = item.get('icon_path')
            if icon_path and os.path.exists(icon_path):
                try:
                    icon, icon_hover = load_icon_pair(icon_path)
                except tk.TclError:
                    icon = None
                    icon_hover = None
            self.apps.append(AppEntry(item.get('name', ''), item.get('path', ''),
                                       icon=icon, icon_hover=icon_hover, icon_path=icon_path))

    def _save_settings(self):
        data = {
            'background_sound': self.background_sound_path,
            'recent_sounds': self.recent_sounds,
            'muted': self.muted,
            'theme_color': self.theme_color,
            'background_style': self.background_style,
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

        self.muted = bool(data.get('muted', False))
        self.recent_sounds = [p for p in data.get('recent_sounds', []) if isinstance(p, str)]

        theme_color = data.get('theme_color')
        if theme_color:
            self.theme_color = theme_color
            self.theme = compute_theme(theme_color)

        background_style = data.get('background_style')
        if background_style in BACKGROUND_STYLE_ORDER:
            self.background_style = background_style

        bg_sound = data.get('background_sound')
        if bg_sound and os.path.exists(bg_sound):
            self.start_background_sound(bg_sound)

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
                icon, icon_hover = load_icon_pair(icon_path)
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

    def browse_background_sound(self):
        path = filedialog.askopenfilename(
            title='Choose background sound',
            filetypes=[('Audio files', '*.mp3 *.wav *.m4a *.aiff *.ogg'), ('All files', '*.*')],
            parent=self.root,
        )
        if not path:
            return
        if not _get_sound_player():
            messagebox.showinfo(
                'No audio player found',
                'Could not find a way to play audio on this system '
                '(looked for afplay / mpg123 / ffplay). The file was not set.',
            )
            return
        self.start_background_sound(path)
        self._remember_recent_sound(path)
        self._save_settings()
        self.open_music_screen()

    def use_recent_sound(self, path):
        if not os.path.exists(path):
            messagebox.showerror('Music not found', 'This file no longer exists:\n{}'.format(path))
            if path in self.recent_sounds:
                self.recent_sounds.remove(path)
                self._save_settings()
            self.open_music_screen()
            return
        self.start_background_sound(path)
        self._remember_recent_sound(path)
        self._save_settings()
        self.open_music_screen()

    def remove_background_sound(self):
        self.stop_background_sound()
        self._save_settings()
        self.open_music_screen()

    def _remember_recent_sound(self, path):
        if path in self.recent_sounds:
            self.recent_sounds.remove(path)
        self.recent_sounds.insert(0, path)
        self.recent_sounds = self.recent_sounds[:5]

    def choose_theme_color(self):
        _rgb, hex_color = colorchooser.askcolor(
            title='Choose menu color', initialcolor=self.theme_color, parent=self.root,
        )
        if not hex_color:
            return
        self.set_theme_color(hex_color)

    def set_theme_color(self, hex_color):
        self.theme_color = hex_color
        self.theme = compute_theme(hex_color)
        self._save_settings()
        self.open_settings()

    def set_background_style(self, style):
        if style in BACKGROUND_STYLE_ORDER:
            self.background_style = style
        self._save_settings()
        self.open_background_style_screen()

    def toggle_mute(self):
        self.muted = not self.muted
        if self.muted:
            if self.background_sound_proc is not None and self.background_sound_proc.poll() is None:
                self.background_sound_proc.terminate()
            self.background_sound_proc = None
        elif self.background_sound_path:
            self._bg_sound_token += 1
            self._play_bg_sound_once(self._bg_sound_token)
        self._save_settings()

    def start_background_sound(self, path):
        self.stop_background_sound()
        self.background_sound_path = path
        self._bg_sound_token += 1
        self._play_bg_sound_once(self._bg_sound_token)

    def _play_bg_sound_once(self, token):
        if token != self._bg_sound_token:
            return
        if self.muted:
            self.background_sound_proc = None
        else:
            self.background_sound_proc = play_sound(self.background_sound_path)
        self.root.after(1000, self._watch_bg_sound, token)

    def _watch_bg_sound(self, token):
        if token != self._bg_sound_token:
            return
        proc = self.background_sound_proc
        if proc is None or proc.poll() is not None:
            self._play_bg_sound_once(token)
        else:
            self.root.after(1000, self._watch_bg_sound, token)

    def stop_background_sound(self):
        self._bg_sound_token += 1
        if self.background_sound_proc is not None and self.background_sound_proc.poll() is None:
            self.background_sound_proc.terminate()
        self.background_sound_proc = None
        self.background_sound_path = None

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
        self.stop_background_sound()
        self.root.destroy()


def _icon_for(entry):
    if entry.path == '__music__':
        return '♪'
    if entry.path in ('__remove_game__', '__remove_music__'):
        return '🗑'
    if entry.path == '__browse__':
        return '📂'
    if entry.path == '__theme_color__':
        return '🎨'
    if entry.path == '__bg_style__':
        return '🌄'
    if entry.path == '__back__':
        return '←'
    return entry.name[:1].upper()


def _action_word(entry):
    if entry.path == '__back__':
        return 'Back'
    if entry.path in ('__remove_game__', '__remove_music__'):
        return 'Remove'
    if entry.path.startswith('__style__:'):
        return 'Select'
    if entry.path in ('__add__', '__music__', '__browse__', '__theme_color__', '__bg_style__'):
        return 'Open'
    return 'Start'


def _make_tile(parent, app, entry, on_activate, action_word=_action_word):
    theme = app.theme
    bg = theme['bg']
    tile_color = theme['tile']
    overlay_color = theme['tile_overlay']

    # Fixed column footprint (sized for the tile's largest hover state) so
    # neither hovering a tile nor a caption's text length ever shifts the
    # tiles next to it. Not packed here — the caller embeds each column
    # directly on the decorated canvas (see build_tile_strip) so the gaps
    # between tiles show the background pattern instead of a flat strip.
    col = tk.Frame(parent, bg=bg, width=TILE_HOVER_W, height=TILE_HOVER_H + 55)
    col.pack_propagate(False)

    tile = tk.Frame(col, bg=tile_color, width=TILE_SIZE, height=TILE_SIZE,
                     highlightthickness=3, highlightbackground=bg, cursor='hand2')
    tile.pack(anchor='n')
    tile.pack_propagate(False)

    action = tk.Label(tile, text=action_word(entry), bg=overlay_color,
                       fg='white', font=('Helvetica', 9))
    action.pack(side='bottom', fill='x')

    if entry.preview_style is not None:
        icon = tk.Canvas(tile, bg=tile_color, highlightthickness=0)

        def draw_preview(event):
            icon.delete('all')
            draw_style_preview(icon, entry.preview_style, theme, event.width, event.height)

        icon.bind('<Configure>', draw_preview)
    elif entry.icon is not None:
        icon = tk.Label(tile, image=entry.icon, bg=tile_color)
    else:
        icon = tk.Label(tile, text=_icon_for(entry), bg=tile_color, fg='white', font=('Helvetica', 30))
    icon.pack(expand=True, fill='both')

    caption = tk.Label(col, text=entry.name, bg=bg, fg='white', font=('Helvetica', 10),
                        wraplength=TILE_HOVER_W, justify='center')
    caption.pack(pady=(8, 0))

    def on_enter(_event=None):
        tile.configure(highlightbackground='white', width=TILE_HOVER_W, height=TILE_HOVER_H)
        if entry.icon_hover is not None:
            icon.configure(image=entry.icon_hover)
        elif entry.icon is None and entry.preview_style is None:
            icon.configure(font=('Helvetica', 38))
        play_nav_sound(app)

    def on_leave(_event=None):
        tile.configure(highlightbackground=bg, width=TILE_SIZE, height=TILE_SIZE)
        if entry.icon_hover is not None:
            icon.configure(image=entry.icon)
        elif entry.icon is None and entry.preview_style is None:
            icon.configure(font=('Helvetica', 30))

    def on_click(_event):
        on_activate(entry)

    for widget in (tile, icon, action):
        widget.bind('<Enter>', on_enter)
        widget.bind('<Leave>', on_leave)
        widget.bind('<Button-1>', on_click)

    return col, on_enter, on_leave


BACKGROUND_REF_W, BACKGROUND_REF_H = 900, 480


def make_background_decorator(app, width=BACKGROUND_REF_W, height=BACKGROUND_REF_H):
    def draw_background(canvas):
        draw = BACKGROUND_STYLES.get(app.background_style, _draw_waves)
        draw(canvas, app.theme, width, height)
    return draw_background


def draw_style_preview(canvas, style, theme, width, height):
    draw = BACKGROUND_STYLES.get(style, _draw_waves)
    draw(canvas, theme, width, height)


def build_header_canvas(parent, app, height=75):
    """A header row drawn on the same decorated background as the rest of the
    menu, so the chosen background style shows through the gaps between the
    header items instead of stopping at a flat strip."""
    bg = app.theme['bg']
    canvas = tk.Canvas(parent, bg=bg, height=height, highlightthickness=0)
    canvas.pack(fill='x', side='top', pady=(10, 0))
    make_background_decorator(app)(canvas)

    left = tk.Frame(canvas, bg=bg)
    canvas.create_window((15, height // 2), window=left, anchor='w')

    right = tk.Frame(canvas, bg=bg)
    right_id = canvas.create_window((0, height // 2), window=right, anchor='e')

    def reposition(event):
        canvas.coords(right_id, event.width - 15, height // 2)

    canvas.bind('<Configure>', reposition)
    return left, right


def build_tile_strip(parent, app, entries, on_activate, nav, decorate=None, action_word=_action_word):
    # Each tile column is embedded on the canvas individually (rather than
    # packed into one opaque row-wide frame) so the decorated background
    # shows through the gaps between tiles instead of being hidden behind a
    # flat strip the width of the whole row.
    bg = app.theme['bg']
    outer = tk.Frame(parent, bg=bg)
    outer.pack(fill='both', expand=True, pady=(0, 10))

    canvas = tk.Canvas(outer, bg=bg, highlightthickness=0)
    bar = tk.Scrollbar(outer, orient='horizontal', command=canvas.xview)
    canvas.configure(xscrollcommand=bar.set)
    canvas.pack(side='top', fill='both', expand=True)
    bar.pack(side='bottom', fill='x')

    if decorate:
        decorate(canvas)

    col_width = TILE_HOVER_W
    col_height = TILE_HOVER_H + 55
    x = TILE_GAP // 2
    for entry in entries:
        col, on_enter, on_leave = _make_tile(canvas, app, entry, on_activate, action_word)
        canvas.create_window((x, 0), window=col, anchor='nw')
        x += col_width + TILE_GAP
        nav.add(on_enter, on_leave, lambda e=entry: on_activate(e))

    canvas.configure(scrollregion=(0, 0, x, col_height))


def _make_header_button(parent, app, activate, build_content):
    bg = app.theme['bg']
    frame = tk.Frame(parent, bg=bg, highlightthickness=2, highlightbackground=bg, cursor='hand2')
    frame.pack(side='right', padx=10)
    content = build_content(frame)
    content.pack(padx=6, pady=4)

    def on_enter(_event=None):
        frame.configure(highlightbackground='white')
        play_nav_sound(app)

    def on_leave(_event=None):
        frame.configure(highlightbackground=bg)

    def on_click(_event):
        activate()

    for widget in (frame, content):
        widget.bind('<Enter>', on_enter)
        widget.bind('<Leave>', on_leave)
        widget.bind('<Button-1>', on_click)

    return on_enter, on_leave


class PS4Menu(tk.Frame):
    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)
        self.nav = KeyboardNav(self)
        header_nav_items = self._build_header()
        self._build_tiles()
        for item in header_nav_items:
            self.nav.add(*item)
        self.nav.finish()

    def _build_header(self):
        bg = self.app.theme['bg']
        left, right = build_header_canvas(self, self.app)
        self._header_item(left, 'notification', 'Welcome back')
        self._header_item(left, 'user', 'Player')
        self._header_item(left, 'friends', '+0')
        self._header_item(left, 'trophy', '+{}'.format(len(self.app.apps)))

        nav_items = []

        settings_focus, settings_unfocus = _make_header_button(
            right, self.app, self.app.open_settings,
            lambda frame: tk.Label(frame, text='⚙', bg=bg, fg='white', font=('Helvetica', 18)),
        )
        nav_items.append((settings_focus, settings_unfocus, self.app.open_settings))

        power_focus, power_unfocus = _make_header_button(
            right, self.app, self.app.quit,
            lambda frame: tk.Label(frame, image=self.app.icons['off'], bg=bg),
        )
        nav_items.append((power_focus, power_unfocus, self.app.quit))

        mute_focus, mute_unfocus = _make_header_button(
            right, self.app, self._toggle_mute,
            lambda frame: tk.Label(frame, text=self._mute_symbol(), bg=bg, fg='white', font=('Helvetica', 16)),
        )
        nav_items.append((mute_focus, mute_unfocus, self._toggle_mute))

        self.clock_label = tk.Label(right, text='', bg=bg, fg='white', font=('Helvetica', 14))
        self.clock_label.pack(side='right', padx=20)
        self._tick_clock()

        return nav_items

    def _toggle_mute(self):
        self.app.toggle_mute()
        self.app.render()

    def _mute_symbol(self):
        return '🔇' if self.app.muted else '🔊'

    def _header_item(self, parent, icon_key, text):
        bg = self.app.theme['bg']
        frame = tk.Frame(parent, bg=bg)
        frame.pack(side='left', padx=15)
        icon = self.app.icons.get(icon_key)
        if icon is not None:
            tk.Label(frame, image=icon, bg=bg).pack(side='left', padx=(0, 6))
        tk.Label(frame, text=text, bg=bg, fg='white', font=('Helvetica', 12)).pack(side='left')

    def _tick_clock(self):
        self.clock_label.config(text=time.strftime('%H:%M'))
        self.after(1000, self._tick_clock)

    def _build_tiles(self):
        build_tile_strip(self, self.app, list(self.app.apps), self._activate, self.nav,
                          decorate=make_background_decorator(self.app))

    def _activate(self, entry):
        self.app.launch(entry)


class SettingsScreen(tk.Frame):
    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)
        self.nav = KeyboardNav(self, on_escape=self.app.render)
        self._build_header()
        self._build_tiles()
        self.nav.finish()

    def _build_header(self):
        bg = self.app.theme['bg']
        left, _right = build_header_canvas(self, self.app)
        tk.Label(left, text='Settings', bg=bg, fg='white',
                 font=('Helvetica', 16, 'bold')).pack(side='left')

    def _build_tiles(self):
        entries = [
            AppEntry('Add Game', '__add__', icon=self.app.plus_icon, icon_hover=self.app.plus_icon_hover),
            AppEntry('Remove Game', '__remove_game__'),
            AppEntry('Music', '__music__'),
            AppEntry('Menu Color', '__theme_color__'),
            AppEntry('Background Style', '__bg_style__'),
            AppEntry('Back', '__back__'),
        ]
        build_tile_strip(self, self.app, entries, self._activate, self.nav,
                          decorate=make_background_decorator(self.app))

    def _activate(self, entry):
        if entry.path == '__add__':
            self.app.add_app_dialog()
        elif entry.path == '__remove_game__':
            self.app.open_manage_games_screen()
        elif entry.path == '__music__':
            self.app.open_music_screen()
        elif entry.path == '__theme_color__':
            self.app.open_color_screen()
        elif entry.path == '__bg_style__':
            self.app.open_background_style_screen()
        elif entry.path == '__back__':
            self.app.render()


def _remove_action_word(entry):
    return 'Back' if entry.path == '__back__' else 'Remove'


class RemoveGameScreen(tk.Frame):
    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)
        self.nav = KeyboardNav(self, on_escape=self.app.open_settings)
        self._build_header()
        self._build_tiles()
        self.nav.finish()

    def _build_header(self):
        bg = self.app.theme['bg']
        left, _right = build_header_canvas(self, self.app)
        tk.Label(left, text='Remove Game', bg=bg, fg='white',
                 font=('Helvetica', 16, 'bold')).pack(side='left')

    def _build_tiles(self):
        entries = list(self.app.apps) + [AppEntry('Back', '__back__')]
        build_tile_strip(self, self.app, entries, self._activate, self.nav,
                          decorate=make_background_decorator(self.app),
                          action_word=_remove_action_word)

    def _activate(self, entry):
        if entry.path == '__back__':
            self.app.open_settings()
            return
        if messagebox.askyesno(
            'Remove game', 'Remove "{}" from the launcher?'.format(entry.name), parent=self.app.root,
        ):
            self.app.remove_app(entry)


def _music_action_word(entry):
    if entry.path == '__back__':
        return 'Back'
    if entry.path == '__browse__':
        return 'Open'
    if entry.path == '__remove_music__':
        return 'Remove'
    return 'Play'


class MusicScreen(tk.Frame):
    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)
        self.nav = KeyboardNav(self, on_escape=self.app.open_settings)
        self._build_header()
        self._build_tiles()
        self.nav.finish()

    def _build_header(self):
        bg = self.app.theme['bg']
        left, _right = build_header_canvas(self, self.app)
        tk.Label(left, text='Music', bg=bg, fg='white',
                 font=('Helvetica', 16, 'bold')).pack(side='left')

    def _build_tiles(self):
        entries = []
        for path in self.app.recent_sounds:
            name = os.path.basename(path)
            if path == self.app.background_sound_path:
                name += ' (current)'
            entries.append(AppEntry(name, path))
        entries.append(AppEntry('Browse...', '__browse__'))
        if self.app.background_sound_path:
            entries.append(AppEntry('Remove Music', '__remove_music__'))
        entries.append(AppEntry('Back', '__back__'))
        build_tile_strip(self, self.app, entries, self._activate, self.nav,
                          decorate=make_background_decorator(self.app),
                          action_word=_music_action_word)

    def _activate(self, entry):
        if entry.path == '__browse__':
            self.app.browse_background_sound()
        elif entry.path == '__remove_music__':
            self.app.remove_background_sound()
        elif entry.path == '__back__':
            self.app.open_settings()
        else:
            self.app.use_recent_sound(entry.path)


class BackgroundStyleScreen(tk.Frame):
    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)
        self.nav = KeyboardNav(self, on_escape=self.app.open_settings)
        self._build_header()
        self._build_tiles()
        self.nav.finish()

    def _build_header(self):
        bg = self.app.theme['bg']
        left, _right = build_header_canvas(self, self.app)
        tk.Label(left, text='Background Style', bg=bg, fg='white',
                 font=('Helvetica', 16, 'bold')).pack(side='left')

    def _build_tiles(self):
        entries = []
        for style in BACKGROUND_STYLE_ORDER:
            label = BACKGROUND_STYLE_LABELS[style]
            if style == self.app.background_style:
                label += ' ✓'
            entries.append(AppEntry(label, '__style__:' + style, preview_style=style))
        entries.append(AppEntry('Back', '__back__'))
        build_tile_strip(self, self.app, entries, self._activate, self.nav,
                          decorate=make_background_decorator(self.app))

    def _activate(self, entry):
        if entry.path == '__back__':
            self.app.open_settings()
        elif entry.path.startswith('__style__:'):
            self.app.set_background_style(entry.path.split(':', 1)[1])


class ColorChannelScreen(tk.Frame):
    """R/G/B sliders adjusted with Up/Down to pick a row and Left/Right to
    change its value — the controller-friendly alternative to the native
    color panel, which is an OS dialog we have no ability to add keyboard/
    controller navigation to."""

    STEP = 8
    BAR_W = 260
    BAR_H = 22
    ROW_COUNT = 5  # Red, Green, Blue, Apply, Back

    def __init__(self, parent, app):
        super().__init__(parent, bg=app.theme['bg'])
        self.app = app
        self.pack(fill='both', expand=True)

        r, g, b = _hex_to_rgb(app.theme_color)
        self.values = [r, g, b]
        self.index = 0
        self.rows = []

        bg = app.theme['bg']
        left, _right = build_header_canvas(self, app)
        tk.Label(left, text='Menu Color', bg=bg, fg='white', font=('Helvetica', 16, 'bold')).pack(side='left')

        body = tk.Frame(self, bg=bg)
        body.pack(fill='both', expand=True, padx=50, pady=10)

        self.preview = tk.Frame(body, width=140, height=140,
                                 highlightthickness=3, highlightbackground=bg)
        self.preview.pack(pady=(0, 20))
        self.preview.pack_propagate(False)

        for name in ('Red', 'Green', 'Blue'):
            row_frame = tk.Frame(body, bg=bg, highlightthickness=2, highlightbackground=bg)
            row_frame.pack(fill='x', pady=6, ipady=6)
            tk.Label(row_frame, text=name, bg=bg, fg='white', font=('Helvetica', 12),
                     width=7, anchor='w').pack(side='left', padx=(10, 0))
            bar = tk.Canvas(row_frame, width=self.BAR_W, height=self.BAR_H, bg='#1a1a1a', highlightthickness=0)
            bar.pack(side='left', padx=10)
            fill_id = bar.create_rectangle(0, 0, 0, self.BAR_H, fill='white', outline='')
            value_label = tk.Label(row_frame, text='0', bg=bg, fg='white', font=('Helvetica', 12), width=4)
            value_label.pack(side='left')
            self.rows.append({'frame': row_frame, 'bar': bar, 'fill_id': fill_id, 'value_label': value_label})

        actions = tk.Frame(body, bg=bg)
        actions.pack(pady=(20, 0))
        self.apply_frame = tk.Frame(actions, bg=bg, highlightthickness=2, highlightbackground=bg)
        self.apply_frame.pack(side='left', padx=10)
        tk.Label(self.apply_frame, text='Apply', bg=bg, fg='white', font=('Helvetica', 13),
                 padx=16, pady=6).pack()
        self.back_frame = tk.Frame(actions, bg=bg, highlightthickness=2, highlightbackground=bg)
        self.back_frame.pack(side='left', padx=10)
        tk.Label(self.back_frame, text='Back', bg=bg, fg='white', font=('Helvetica', 13),
                 padx=16, pady=6).pack()

        self.bind('<Up>', lambda _e: self._move(-1))
        self.bind('<Down>', lambda _e: self._move(1))
        self.bind('<Left>', lambda _e: self._adjust(-self.STEP))
        self.bind('<Right>', lambda _e: self._adjust(self.STEP))
        self.bind('<Return>', lambda _e: self._activate())
        self.bind('<KP_Enter>', lambda _e: self._activate())
        self.bind('<space>', lambda _e: self._activate())
        self.bind('<Escape>', lambda _e: self.app.open_settings())
        self.focus_set()

        self._refresh()

    def _move(self, delta):
        self.index = (self.index + delta) % self.ROW_COUNT
        play_nav_sound(self.app)
        self._refresh()

    def _adjust(self, delta):
        if self.index < 3:
            self.values[self.index] = max(0, min(255, self.values[self.index] + delta))
            self._refresh()

    def _activate(self):
        if self.index == 3:
            self.app.set_theme_color(_rgb_to_hex(tuple(self.values)))
        elif self.index == 4:
            self.app.open_settings()

    def _refresh(self):
        bg = self.app.theme['bg']
        hex_color = _rgb_to_hex(tuple(self.values))
        self.preview.configure(bg=hex_color)
        for i, row in enumerate(self.rows):
            value = self.values[i]
            row['value_label'].configure(text=str(value))
            width = int(self.BAR_W * value / 255)
            row['bar'].coords(row['fill_id'], 0, 0, width, self.BAR_H)
            row['frame'].configure(highlightbackground='white' if self.index == i else bg)
        self.apply_frame.configure(highlightbackground='white' if self.index == 3 else bg)
        self.back_frame.configure(highlightbackground='white' if self.index == 4 else bg)


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == '--relaunch-after':
        run_relaunch_watcher(sys.argv[2])
        return
    root = tk.Tk()
    ConsoleLauncher(root)
    root.mainloop()


if __name__ == '__main__':
    main()
