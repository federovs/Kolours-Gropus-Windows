import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';


const GRAYSCALE_LEVELS = {
    LEVEL_1: 0.25,
    LEVEL_2: 0.5,
    LEVEL_3: 0.75,
    LEVEL_4: 1.0,
    SEPIA: 'sepia'
};


const SHORTCUTS = {
    TOGGLE_WINDOW: 'grayscale-window-shortcut',
    TOGGLE_GLOBAL: 'grayscale-global-shortcut',
    WINDOW_GROUP: 'window-group-shortcut',
    LEVEL_1: 'grayscale-level-1-shortcut',
    LEVEL_2: 'grayscale-level-2-shortcut',
    LEVEL_3: 'grayscale-level-3-shortcut',
    LEVEL_4: 'grayscale-level-4-shortcut',
    SEPIA: 'grayscale-sepia-shortcut'
};


export const GrayscaleEffect = GObject.registerClass(
class GrayscaleEffect extends Clutter.ShaderEffect {
    _init(level = 1.0) {
        super._init();
        this._level = level;

        if (level === GRAYSCALE_LEVELS.SEPIA) {
            // Shader para efecto sepia
            this.shader_type = Clutter.ShaderType.FRAGMENT_SHADER;
            this.set_shader_source(`
                uniform sampler2D tex;
                uniform float amount;
                void main () {
                    vec4 color = texture2D(tex, cogl_tex_coord_in[0].st);
                    float r = color.r;
                    float g = color.g;
                    float b = color.b;

                    color.r = min(1.0, (r * (1.0 - (0.607 * amount))) + (g * (0.769 * amount)) + (b * (0.189 * amount)));
                    color.g = min(1.0, (r * (0.349 * amount)) + (g * (1.0 - (0.314 * amount))) + (b * (0.168 * amount)));
                    color.b = min(1.0, (r * (0.272 * amount)) + (g * (0.534 * amount)) + (b * (1.0 - (0.869 * amount))));

                    cogl_color_out = color;
                }
            `);
            this.set_uniform_value('amount', 0.8); // Intensidad sepia
        } else {
            // Shader para escala de grises normal
            this.shader_type = Clutter.ShaderType.FRAGMENT_SHADER;
            this.set_shader_source(`
                uniform sampler2D tex;
                uniform float factor;
                void main () {
                    vec4 color = texture2D(tex, cogl_tex_coord_in[0].st);
                    float intensity = (color.r + color.g + color.b) / 3.0;
                    float gray = mix(color.r, intensity, factor);
                    cogl_color_out = vec4(mix(color.rgb, vec3(gray), factor), color.a);
                }
            `);
            this.set_uniform_value('factor', level);
        }
    }

    set level(value) {
        this._level = value;
        if (this._level !== GRAYSCALE_LEVELS.SEPIA) {
            this.set_uniform_value('factor', value);
        }
    }

    get level() {
        return this._level;
    }
});


export const WindowGrouper = GObject.registerClass(
class WindowGrouper extends St.Widget {
    _init() {
        super._init({
            style_class: 'window-grouper',
            layout_manager: new Clutter.GridLayout(),
            reactive: true
        });

        this._windows = [];
        this._thumbnails = new Map();
        this._selectedIndex = 0;


        const layout = this.layout_manager;
        layout.set_orientation(Clutter.Orientation.HORIZONTAL);
        layout.set_row_spacing(12);
        layout.set_column_spacing(12);


        this._updateWindows();


        this._createThumbnails();


        this.connect('key-press-event', this._handleKeyPress.bind(this));
        this.connect('key-release-event', this._handleKeyRelease.bind(this));
    }

    _updateWindows() {
        this._windows = global.get_window_actors()
            .filter(actor => {
                const metaWindow = actor.get_meta_window();
                return metaWindow &&
                       metaWindow.get_window_type() === Meta.WindowType.NORMAL &&
                       !metaWindow.minimized &&
                       metaWindow.get_workspace() === global.workspace_manager.get_active_workspace();
            });
    }

    _createThumbnails() {

        this.remove_all_children();
        this._thumbnails.clear();


        const windowCount = this._windows.length;
        const columns = Math.ceil(Math.sqrt(windowCount));
        const rows = Math.ceil(windowCount / columns);


        this._windows.forEach((actor, index) => {
            const metaWindow = actor.get_meta_window();
            const title = metaWindow.get_title();

            // Crear contenedor de miniatura
            const thumbnail = new St.BoxLayout({
                vertical: true,
                style_class: 'window-thumbnail',
                reactive: true
            });


            const image = new St.Bin({
                style_class: 'window-thumbnail-image',
                width: 200,
                height: 120,

            });

            // Crear título de ventana
            const label = new St.Label({
                text: title.length > 20 ? title.substring(0, 20) + '...' : title,
                style_class: 'window-thumbnail-label'
            });


            thumbnail.add_child(image);
            thumbnail.add_child(label);


            thumbnail.connect('button-press-event', () => {
                this._selectWindow(index);
                this._activateSelected();
            });

            thumbnail.connect('enter-event', () => {
                this._selectWindow(index);
            });

            // Añadir a la cuadrícula
            const layout = this.layout_manager;
            layout.attach(thumbnail, index % columns, Math.floor(index / columns), 1, 1);

            this.add_child(thumbnail);
            this._thumbnails.set(metaWindow, thumbnail);
        });


        if (windowCount > 0) {
            this._selectWindow(0);
        }
    }

    _selectWindow(index) {

        if (this._selectedIndex >= 0 && this._selectedIndex < this._windows.length) {
            const prevThumbnail = this.get_children()[this._selectedIndex];
            prevThumbnail.remove_style_pseudo_class('selected');
        }


        this._selectedIndex = index;
        const newThumbnail = this.get_children()[index];
        newThumbnail.add_style_pseudo_class('selected');
    }

    _activateSelected() {
        if (this._selectedIndex >= 0 && this._selectedIndex < this._windows.length) {
            const actor = this._windows[this._selectedIndex];
            const metaWindow = actor.get_meta_window();

            metaWindow.activate(global.get_current_time());
            this.destroy();
        }
    }

    _handleKeyPress(actor, event) {
        const symbol = event.get_key_symbol();

        switch(symbol) {
            case Clutter.KEY_Escape:
                this.destroy();
                return true;
            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
                this._activateSelected();
                return true;
            case Clutter.KEY_Left:
                this._selectWindow((this._selectedIndex - 1 + this._windows.length) % this._windows.length);
                return true;
            case Clutter.KEY_Right:
                this._selectWindow((this._selectedIndex + 1) % this._windows.length);
                return true;
            case Clutter.KEY_Up:
                const columns = Math.ceil(Math.sqrt(this._windows.length));
                this._selectWindow((this._selectedIndex - columns + this._windows.length) % this._windows.length);
                return true;
            case Clutter.KEY_Down:
                const cols = Math.ceil(Math.sqrt(this._windows.length));
                this._selectWindow((this._selectedIndex + cols) % this._windows.length);
                return true;
        }

        return false;
    }

    _handleKeyRelease(actor, event) {
        return false;
    }
});

export default class EnhancedGrayscaleExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._windowGroupers = new Map();
    }


    applyEffectToWindow(level) {
        global.get_window_actors().forEach(actor => {
            const metaWindow = actor.get_meta_window();
            if (metaWindow && metaWindow.has_focus()) {

                this.removeEffectFromWindow(metaWindow);

                // Aplicar nuevo efecto
                if (level !== null) {
                    const effect = new GrayscaleEffect(level);
                    actor.add_effect_with_name('grayscale-effect', effect);
                    meta_window._grayscale_level = level;
                }
            }
        });
    }


    removeEffectFromWindow(metaWindow) {
        const actor = metaWindow.get_compositor_private();
        if (actor) {
            actor.remove_effect_by_name('grayscale-effect');
            delete metaWindow._grayscale_level;
        }
    }


    toggleGlobalEffect() {
        if (Main.uiGroup.get_effect('grayscale-effect')) {
            Main.uiGroup.remove_effect_by_name('grayscale-effect');
        } else {
            const effect = new GrayscaleEffect(GRAYSCALE_LEVELS.LEVEL_4);
            Main.uiGroup.add_effect_with_name('grayscale-effect', effect);
        }
    }


    showWindowGrouper() {

        const modal = new WindowGrouper();
        modal.width = global.stage.width;
        modal.height = global.stage.height;


        Main.uiGroup.add_child(modal);
        modal.grab_key_focus();


        this._windowGroupers.set(modal, true);


        modal.connect('destroy', () => {
            this._windowGroupers.delete(modal);
        });
    }

    enable() {
        this._settings = this.getSettings();


        Main.wm.addKeybinding(
            SHORTCUTS.TOGGLE_WINDOW,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => { this.applyEffectToWindow(GRAYSCALE_LEVELS.LEVEL_4); }
        );

        Main.wm.addKeybinding(
            SHORTCUTS.TOGGLE_GLOBAL,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => { this.toggleGlobalEffect(); }
        );

        Main.wm.addKeybinding(
            SHORTCUTS.WINDOW_GROUP,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => { this.showWindowGrouper(); }
        );

        // Atajos para niveles específicos
        Main.wm.addKeybinding(
            SHORTCUTS.LEVEL_1,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => { this.applyEffectToWindow(GRAYSCALE_LEVELS.LEVEL_1); }
        );

        Main.wm.addKeybinding(
            SHORTCUTS.LEVEL_2,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => { this.applyEffectToWindow(GRAYSCALE_LEVELS.LEVEL_2); }
        );

        Main.wm.addKeybinding(
            SHORTCUTS.LEVEL_3,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => { this.applyEffectToWindow(GRAYSCALE_LEVELS.LEVEL_3); }
        );

        Main.wm.addKeybinding(
            SHORTCUTS.LEVEL_4,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => { this.applyEffectToWindow(GRAYSCALE_LEVELS.LEVEL_4); }
        );

        Main.wm.addKeybinding(
            SHORTCUTS.SEPIA,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => { this.applyEffectToWindow(GRAYSCALE_LEVELS.SEPIA); }
        );


        this.restoreWindowEffects();
    }

    disable() {

        Object.values(SHORTCUTS).forEach(shortcut => {
            Main.wm.removeKeybinding(shortcut);
        });


        global.get_window_actors().forEach(actor => {
            actor.remove_effect_by_name('grayscale-effect');
        });

        Main.uiGroup.remove_effect_by_name('grayscale-effect');


        this._windowGroupers.forEach((value, grouper) => {
            grouper.destroy();
        });
        this._windowGroupers.clear();

        this._settings = null;
    }


    restoreWindowEffects() {
        global.get_window_actors().forEach(actor => {
            const metaWindow = actor.get_meta_window();
            if (metaWindow && metaWindow._grayscale_level) {
                const effect = new GrayscaleEffect(metaWindow._grayscale_level);
                actor.add_effect_with_name('grayscale-effect', effect);
            }
        });
    }
}
