/* oxlint-disable react/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type Language = 'tr' | 'en';

const LANGUAGE_STORAGE_KEY = 'dashboard-language-v1';

const tr = {
  'common.add': 'Ekle',
  'common.delete': 'Sil',
  'common.deleteAll': 'Tümünü Sil',
  'common.history': 'Geçmiş',
  'common.close': 'Kapat',
  'common.existing': 'mevcut',
  'app.dashboard': 'Dashboard',
  'app.taskCount': '{count} görev',
  'app.tasksCount': '{count} görev',
  'app.automationCount': '{count} otomasyon',
  'app.automationsCount': '{count} otomasyon',
  'window.move': 'Taşı',
  'window.moveTitle': 'Pencereyi taşı',
  'window.minimize': 'Küçült',
  'window.maximize': 'Büyüt veya geri al',
  'window.hideToTray': "System Tray'e gizle",
  'app.loading': 'Yükleniyor…',
  'settings.title': 'Ayarlar',
  'settings.open': 'Ayarları aç',
  'settings.language': 'Dil',
  'settings.turkish': 'Türkçe',
  'settings.english': 'İngilizce',
  'settings.background': 'Arka plan',
  'settings.backgroundTransparency': 'Arka Plan Şeffaflığı',
  'settings.cards': 'Kartlar',
  'settings.cardHeadings': 'Kart Başlıkları',
  'settings.infoText': 'Bilgi Yazıları',
  'settings.windowsFrame': 'Windows Çerçevesi',
  'settings.workspaceTitle': 'Çalışma alanı başlığı',
  'settings.workspaceTitleColor': 'Çalışma alanı başlık rengi',
  'settings.resetTheme': 'Tema Varsayılanına Dön',
  'settings.about': 'Hakkında',
  'settings.aboutText': 'Hiçbir hakkı saklı değildir. | | | İsmail :v',
  'settings.qrLabel': 'YouTube bağlantısı kare kodu',
  'dateTime.label': '{date}, saat {time}',
  'tasks.title': 'Görevler',
  'tasks.calendar': 'Takvim',
  'tasks.newTask': 'Yeni görev ekle',
  'tasks.date': 'Görev tarihi',
  'tasks.reminderTime': 'Hatırlatma saati',
  'tasks.deleteNamed': 'Görevi sil: {name}',
  'tasks.deleteTitle': 'Görevi sil',
  'calendar.previousMonth': 'Önceki ay',
  'calendar.nextMonth': 'Sonraki ay',
  'calendar.hasNote': 'Bu günde not var',
  'calendar.dayDone': 'Gün tamamlandı',
  'calendar.dayMissed': 'Gün tamamlanmadı',
  'calendar.done': 'Tamamlandı',
  'calendar.missed': 'Tamamlanmadı',
  'calendar.noTasks': 'Bu tarih için görev yok.',
  'calendar.selectedDayNote': 'Seçili gün notu',
  'calendar.addDayNote': 'Seçili güne not ekle',
  'calendar.dayStatus': 'Seçili gün durumu',
  'calendar.markDone': 'Seçili günü tamamlandı olarak işaretle',
  'calendar.markMissed': 'Seçili günü tamamlanmadı olarak işaretle',
  'automation.title': 'Otomasyon',
  'automation.remove': 'Otomasyonu Kaldır',
  'automation.removeMany': 'Otomasyonları Kaldır',
  'automation.name': 'Otomasyon Adı',
  'automation.color': 'Otomasyon rengi',
  'automation.create': 'Otomasyonu Oluştur',
  'automation.selectCycle': '{frequency} döngüyü seç{existing}',
  'automation.defaultName': '{frequency} Döngü',
  'automation.daily': 'Günlük',
  'automation.weekly': 'Haftalık',
  'automation.monthly': 'Aylık',
  'automation.yearly': 'Yıllık',
  'history.taskHistory': 'Görev geçmişi',
  'history.closeTaskHistory': 'Görev geçmişini kapat',
  'history.deleted': 'Silindi',
  'history.expired': 'Tarihi geçti',
  'history.completed': 'Tamamlandı',
  'history.deletePermanently': 'Geçmişten kalıcı olarak sil: {name}',
  'history.noTasks': 'Silinen, tamamlanan veya tarihi geçmiş görev yok.',
  'note.title': 'Hızlı Not',
  'note.saved': 'Kaydedildi',
  'note.neverSaved': 'Henüz kaydedilmedi',
  'note.editorLabel': 'Hızlı not metni',
  'note.placeholder': 'Buraya bir not yazın...',
  'note.resize': 'Not alanının yüksekliğini değiştir',
  'note.toolbar': 'Metin biçimlendirme araçları',
  'note.marker': '{color} marker',
  'note.clearMarker': 'Seçili metindeki markerı temizle',
  'note.clearMarkerButton': 'Markerı temizle',
  'note.bulletList': 'Noktalı madde listesi',
  'note.hyphenList': 'Tireli madde listesi',
  'note.textColorTitle': 'Seçili metin veya tüm Hızlı Not yazı rengi',
  'note.textColor': 'Hızlı Not yazı rengi',
  'note.saving': 'Kaydediliyor…',
  'note.save': 'Kaydet',
  'note.storageWarning': 'Notlar bu cihazda şifrelenmeden saklanır; parola veya erişim anahtarı kaydetmeyin.',
  'note.loadError': 'Kaydedilmiş not yüklenemedi.',
  'note.saveError': 'Not kaydedilemedi. Lütfen tekrar deneyin.',
  'note.tooLong': 'Not en fazla {count} karakter olabilir.',
  'color.yellow': 'Sarı',
  'color.green': 'Yeşil',
  'color.blue': 'Mavi',
  'color.purple': 'Mor',
  'color.red': 'Kırmızı',
  'color.orange': 'Turuncu',
  'color.pink': 'Pembe',
  'color.turquoise': 'Turkuaz',
  'calculator.title': 'Hesap Makinesi',
  'calculator.label': 'Hesap makinesi',
  'calculator.mode': 'Hesap makinesi modu',
  'calculator.standard': 'Standart',
  'calculator.scientific': 'Bilimsel',
  'calculator.display': 'LCD hesaplama ekranı',
  'calculator.result': 'Hesap makinesi sonucu',
  'calculator.angleUnit': 'Açı birimi: {mode}',
  'calculator.inverseSine': 'Ters sinüs',
  'calculator.inverseCosine': 'Ters kosinüs',
  'calculator.inverseTangent': 'Ters tanjant',
  'calculator.naturalLog': 'Doğal logaritma',
  'calculator.base10Log': '10 tabanında logaritma',
  'calculator.squareRoot': 'Karekök',
  'calculator.square': 'Karesi',
  'calculator.power': 'Üs',
  'calculator.factorial': 'Faktöriyel',
  'calculator.reciprocal': 'Tersi',
  'calculator.backspace': 'Son karakteri sil',
  'calculator.divide': 'Böl',
  'calculator.multiply': 'Çarp',
  'calculator.subtract': 'Çıkar',
  'calculator.toggleSign': 'İşareti değiştir',
  'calculator.decimal': 'Ondalık ayırıcı',
  'calculator.add': 'Topla',
  'calculator.percent': 'Yüzde',
  'calculator.calculate': 'Hesapla',
  'calculator.history': 'Hesaplama geçmişi',
  'calculator.closeHistory': 'Hesaplama geçmişini kapat',
  'calculator.deleteHistoryItem': 'Geçmişten sil: {expression}',
  'calculator.noHistory': 'Henüz hesaplama geçmişi yok.',
  'calculator.genericError': 'İşlem hesaplanamadı.',
  'calculator.error.unsupportedExpression': 'Bu ifade türü desteklenmiyor.',
  'calculator.error.unsupportedValue': 'Desteklenmeyen bir değer kullanıldı.',
  'calculator.error.unsupportedFunction': 'Desteklenmeyen bir fonksiyon kullanıldı.',
  'calculator.error.unsupportedOperation': 'Desteklenmeyen bir işlem kullanıldı.',
  'calculator.error.factorialRange': 'Faktöriyel 0 ile 500 arasındaki tam sayılar için kullanılabilir.',
  'calculator.error.powerTooLarge': 'Üs değeri çok büyük.',
  'calculator.error.nonReal': 'Bu işlem gerçek sayı sonucu vermiyor.',
  'calculator.error.undefinedTangent': 'Tanjant bu açıda tanımsız.',
  'calculator.error.emptyExpression': 'Hesaplanacak bir ifade girin.',
  'calculator.error.expressionTooLong': 'İfade çok uzun.',
  'calculator.error.invalidCharacter': 'İfadede geçersiz bir karakter var.',
  'calculator.error.incompleteExpression': 'İfade tamamlanamadı.',
  'calculator.error.calculationFailed': 'İşlem hesaplanamadı.',
  'calculator.error.nonFinite': 'Sonuç sonlu bir sayı değil.',
  'timeTools.label': 'Zaman araçları',
  'timeTools.title': 'Zamanlayıcı & Kronometre',
  'timeTools.selection': 'Zaman aracı seçimi',
  'timeTools.stopwatch': 'Kronometre',
  'timeTools.timer': 'Zamanlayıcı',
  'timeTools.stopwatchDisplay': 'Kronometre ekranı',
  'timeTools.timerDisplay': 'Zamanlayıcı ekranı',
  'timeTools.running': 'Çalışıyor',
  'timeTools.countingDown': 'Geri sayıyor',
  'timeTools.paused': 'Duraklatıldı',
  'timeTools.ready': 'Başlamaya hazır',
  'timeTools.finished': 'Süre doldu',
  'timeTools.stopwatchReset': 'Kronometreyi durdur ve sıfırla',
  'timeTools.stopwatchPause': 'Kronometreyi duraklat',
  'timeTools.stopwatchStart': 'Kronometreyi başlat',
  'timeTools.timerReset': 'Zamanlayıcıyı durdur ve sıfırla',
  'timeTools.timerPause': 'Zamanlayıcıyı duraklat',
  'timeTools.timerStart': 'Zamanlayıcıyı başlat',
  'timeTools.hours': 'Saat',
  'timeTools.minutes': 'Dakika',
  'timeTools.seconds': 'Saniye',
  'reminder.overdueTitle': 'Geciken görev',
  'reminder.overdueBody': '“{name}” görevinin tarihi {days} gün geçti.',
  'reminder.overdueBodyOne': '“{name}” görevinin tarihi {days} gün geçti.',
  'reminder.todayTitle': 'Bugünkü görev',
  'reminder.todayBody': '“{name}” bugün tamamlanmalı.',
  'reminder.upcomingTitle': 'Yaklaşan görev',
  'reminder.upcomingBody': '“{name}” için {days} gün kaldı.',
  'reminder.upcomingBodyOne': '“{name}” için {days} gün kaldı.',
} as const;

const en: Record<keyof typeof tr, string> = {
  'common.add': 'Add', 'common.delete': 'Delete', 'common.deleteAll': 'Delete All', 'common.history': 'History', 'common.close': 'Close', 'common.existing': 'existing',
  'app.dashboard': 'Dashboard', 'app.taskCount': '{count} task', 'app.tasksCount': '{count} tasks', 'app.automationCount': '{count} automation', 'app.automationsCount': '{count} automations', 'window.move': 'Move', 'window.moveTitle': 'Move window', 'window.minimize': 'Minimize', 'window.maximize': 'Maximize or restore', 'window.hideToTray': 'Hide to System Tray', 'app.loading': 'Loading…',
  'settings.title': 'Settings', 'settings.open': 'Open settings', 'settings.language': 'Language', 'settings.turkish': 'Turkish', 'settings.english': 'English', 'settings.background': 'Background', 'settings.backgroundTransparency': 'Background Transparency', 'settings.cards': 'Cards', 'settings.cardHeadings': 'Card Headings', 'settings.infoText': 'Information Text', 'settings.windowsFrame': 'Windows Frame', 'settings.workspaceTitle': 'Workspace title', 'settings.workspaceTitleColor': 'Workspace title color', 'settings.resetTheme': 'Restore Theme Defaults', 'settings.about': 'About', 'settings.aboutText': 'No rights reserved. | | | İsmail :v', 'settings.qrLabel': 'QR code for the YouTube link',
  'dateTime.label': '{date}, time {time}',
  'tasks.title': 'Tasks', 'tasks.calendar': 'Calendar', 'tasks.newTask': 'Add a new task', 'tasks.date': 'Task date', 'tasks.reminderTime': 'Reminder time', 'tasks.deleteNamed': 'Delete task: {name}', 'tasks.deleteTitle': 'Delete task',
  'calendar.previousMonth': 'Previous month', 'calendar.nextMonth': 'Next month', 'calendar.hasNote': 'This day has a note', 'calendar.dayDone': 'Day completed', 'calendar.dayMissed': 'Day not completed', 'calendar.done': 'Completed', 'calendar.missed': 'Not completed', 'calendar.noTasks': 'No tasks for this date.', 'calendar.selectedDayNote': 'Selected day note', 'calendar.addDayNote': 'Add a note to the selected day', 'calendar.dayStatus': 'Selected day status', 'calendar.markDone': 'Mark selected day as completed', 'calendar.markMissed': 'Mark selected day as not completed',
  'automation.title': 'Automation', 'automation.remove': 'Remove Automation', 'automation.removeMany': 'Remove Automations', 'automation.name': 'Automation Name', 'automation.color': 'Automation color', 'automation.create': 'Create Automation', 'automation.selectCycle': 'Select {frequency} cycle{existing}', 'automation.defaultName': '{frequency} Cycle', 'automation.daily': 'Daily', 'automation.weekly': 'Weekly', 'automation.monthly': 'Monthly', 'automation.yearly': 'Yearly',
  'history.taskHistory': 'Task history', 'history.closeTaskHistory': 'Close task history', 'history.deleted': 'Deleted', 'history.expired': 'Overdue', 'history.completed': 'Completed', 'history.deletePermanently': 'Permanently delete from history: {name}', 'history.noTasks': 'There are no deleted, completed, or overdue tasks.',
  'note.title': 'Quick Note', 'note.saved': 'Saved', 'note.neverSaved': 'Not saved yet', 'note.editorLabel': 'Quick note text', 'note.placeholder': 'Write a note here...', 'note.resize': 'Resize note area', 'note.toolbar': 'Text formatting tools', 'note.marker': '{color} highlighter', 'note.clearMarker': 'Clear highlighting from selected text', 'note.clearMarkerButton': 'Clear highlighting', 'note.bulletList': 'Bulleted list', 'note.hyphenList': 'Hyphenated list', 'note.textColorTitle': 'Text color for selected text or the entire Quick Note', 'note.textColor': 'Quick Note text color', 'note.saving': 'Saving…', 'note.save': 'Save', 'note.storageWarning': 'Notes are stored unencrypted on this device; do not save passwords or access keys.', 'note.loadError': 'The saved note could not be loaded.', 'note.saveError': 'The note could not be saved. Please try again.', 'note.tooLong': 'A note can contain up to {count} characters.',
  'color.yellow': 'Yellow', 'color.green': 'Green', 'color.blue': 'Blue', 'color.purple': 'Purple', 'color.red': 'Red', 'color.orange': 'Orange', 'color.pink': 'Pink', 'color.turquoise': 'Turquoise',
  'calculator.title': 'Calculator', 'calculator.label': 'Calculator', 'calculator.mode': 'Calculator mode', 'calculator.standard': 'Standard', 'calculator.scientific': 'Scientific', 'calculator.display': 'LCD calculator display', 'calculator.result': 'Calculator result', 'calculator.angleUnit': 'Angle unit: {mode}', 'calculator.inverseSine': 'Inverse sine', 'calculator.inverseCosine': 'Inverse cosine', 'calculator.inverseTangent': 'Inverse tangent', 'calculator.naturalLog': 'Natural logarithm', 'calculator.base10Log': 'Base-10 logarithm', 'calculator.squareRoot': 'Square root', 'calculator.square': 'Square', 'calculator.power': 'Power', 'calculator.factorial': 'Factorial', 'calculator.reciprocal': 'Reciprocal', 'calculator.backspace': 'Delete last character', 'calculator.divide': 'Divide', 'calculator.multiply': 'Multiply', 'calculator.subtract': 'Subtract', 'calculator.toggleSign': 'Toggle sign', 'calculator.decimal': 'Decimal separator', 'calculator.add': 'Add', 'calculator.percent': 'Percent', 'calculator.calculate': 'Calculate', 'calculator.history': 'Calculation history', 'calculator.closeHistory': 'Close calculation history', 'calculator.deleteHistoryItem': 'Delete from history: {expression}', 'calculator.noHistory': 'No calculation history yet.', 'calculator.genericError': 'The calculation could not be completed.',
  'calculator.error.unsupportedExpression': 'This expression type is not supported.', 'calculator.error.unsupportedValue': 'An unsupported value was used.', 'calculator.error.unsupportedFunction': 'An unsupported function was used.', 'calculator.error.unsupportedOperation': 'An unsupported operation was used.', 'calculator.error.factorialRange': 'Factorial is available for integers from 0 through 500.', 'calculator.error.powerTooLarge': 'The exponent is too large.', 'calculator.error.nonReal': 'This operation does not produce a real-number result.', 'calculator.error.undefinedTangent': 'Tangent is undefined at this angle.', 'calculator.error.emptyExpression': 'Enter an expression to calculate.', 'calculator.error.expressionTooLong': 'The expression is too long.', 'calculator.error.invalidCharacter': 'The expression contains an invalid character.', 'calculator.error.incompleteExpression': 'The expression could not be completed.', 'calculator.error.calculationFailed': 'The calculation could not be completed.', 'calculator.error.nonFinite': 'The result is not a finite number.',
  'timeTools.label': 'Time tools', 'timeTools.title': 'Timer & Stopwatch', 'timeTools.selection': 'Time tool selection', 'timeTools.stopwatch': 'Stopwatch', 'timeTools.timer': 'Timer', 'timeTools.stopwatchDisplay': 'Stopwatch display', 'timeTools.timerDisplay': 'Timer display', 'timeTools.running': 'Running', 'timeTools.countingDown': 'Counting down', 'timeTools.paused': 'Paused', 'timeTools.ready': 'Ready to start', 'timeTools.finished': 'Time is up', 'timeTools.stopwatchReset': 'Stop and reset stopwatch', 'timeTools.stopwatchPause': 'Pause stopwatch', 'timeTools.stopwatchStart': 'Start stopwatch', 'timeTools.timerReset': 'Stop and reset timer', 'timeTools.timerPause': 'Pause timer', 'timeTools.timerStart': 'Start timer', 'timeTools.hours': 'Hours', 'timeTools.minutes': 'Minutes', 'timeTools.seconds': 'Seconds',
  'reminder.overdueTitle': 'Overdue task', 'reminder.overdueBody': '“{name}” is {days} days overdue.', 'reminder.overdueBodyOne': '“{name}” is {days} day overdue.', 'reminder.todayTitle': "Today's task", 'reminder.todayBody': '“{name}” is due today.', 'reminder.upcomingTitle': 'Upcoming task', 'reminder.upcomingBody': '“{name}” is due in {days} days.', 'reminder.upcomingBodyOne': '“{name}” is due in {days} day.',
};

type TranslationKey = keyof typeof tr;
type TranslationParams = Record<string, string | number>;

function translate(language: Language, key: TranslationKey, params?: TranslationParams): string {
  const template = language === 'tr' ? tr[key] : en[key];
  if (!params) return template;
  return Object.entries(params).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

interface LanguageContextValue {
  language: Language;
  locale: 'tr-TR' | 'en-US';
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { readonly children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => (
    window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'tr'
  ));

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
    if ('__TAURI_INTERNALS__' in window) {
      void invoke('set_tray_language', { language });
    }
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    locale: language === 'tr' ? 'tr-TR' : 'en-US',
    setLanguage,
    t: (key, params) => translate(language, key, params),
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}

export function getStoredLanguage(): Language {
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'tr';
}

export function translateStored(key: TranslationKey, params?: TranslationParams): string {
  return translate(getStoredLanguage(), key, params);
}
