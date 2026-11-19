// LVGL settings for the Wrkbench display. Anything not set here takes LVGL's default (lv_conf_internal.h).
#if 1
#ifndef LV_CONF_H
#define LV_CONF_H

#define LV_COLOR_DEPTH 16

// No PSRAM on the CYD: widgets use the normal heap instead of a fixed LVGL pool, so memory not needed for
// the screen stays free for Wi-Fi and TLS.
#define LV_USE_STDLIB_MALLOC LV_STDLIB_CLIB
#define LV_USE_STDLIB_STRING LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF LV_STDLIB_CLIB

#define LV_DEF_REFR_PERIOD 33
#define LV_DPI_DEF 130

#define LV_USE_OS LV_OS_NONE
#define LV_USE_LOG 0
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1

// Two sizes of the built-in font: plain ASCII plus LVGL's symbols (Wi-Fi, warning ...).
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_28 1
#define LV_FONT_DEFAULT &lv_font_montserrat_14

#define LV_USE_THEME_DEFAULT 1
#define LV_THEME_DEFAULT_DARK 1

// Only the widgets the screens use.
#define LV_USE_ANIMIMG 0
#define LV_USE_CALENDAR 0
#define LV_USE_CHART 0
#define LV_USE_IMAGEBUTTON 0
#define LV_USE_LED 0
#define LV_USE_MENU 0
#define LV_USE_ROLLER 0
#define LV_USE_SCALE 0
#define LV_USE_SLIDER 0
#define LV_USE_SPAN 0
#define LV_USE_SPINBOX 0
#define LV_USE_TABVIEW 0
#define LV_USE_TILEVIEW 0
#define LV_USE_WIN 0
#define LV_USE_ARC 1
#define LV_USE_CANVAS 0
#define LV_USE_LIST 1
#define LV_USE_BAR 1
#define LV_USE_BUTTON 1
#define LV_USE_LABEL 1
#define LV_USE_KEYBOARD 1
#define LV_USE_TEXTAREA 1
#define LV_USE_BUTTONMATRIX 1
#define LV_USE_MSGBOX 0
#define LV_USE_SPINNER 1
#define LV_USE_SWITCH 0
#define LV_USE_CHECKBOX 0
#define LV_USE_DROPDOWN 0
#define LV_USE_TABLE 0
#define LV_USE_LINE 0
#define LV_USE_IMAGE 1

#define LV_USE_FLEX 1
#define LV_USE_GRID 0

#endif
#endif
