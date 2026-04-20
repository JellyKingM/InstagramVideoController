const translations = {
    en: {
        settings: "Settings",
        developerLink: "Developer Page",
        donate: "Donate to Developer"
    },
    ko: {
        settings: "옵션 설정",
        developerLink: "개발자 페이지",
        donate: "개발자에게 기부하기"
    },
    es: {
        settings: "Configuraciones",
        developerLink: "Página del Desarrollador",
        donate: "Donar al Desarrollador"
    },
    uk: {
        settings: "Налаштування",
        developerLink: "Сторінка Розробника",
        donate: "Пожертвувати Розробнику"
    },
    zh_CN: {
        settings: "设置",
        developerLink: "开发者页面",
        donate: "捐赠给开发者"
    },
    ja: {
        settings: "設定",
        developerLink: "開発者ページ",
        donate: "開発者に寄付"
    },
    pt_BR: {
        settings: "Configurações",
        developerLink: "Página do Desenvolvedor",
        donate: "Doar ao Desenvolvedor"
    },
    tr: {
        settings: "Ayarlar",
        developerLink: "Geliştirici Sayfası",
        donate: "Geliştiriciye Bağış Yap"
    },
    uz: {
        settings: "Sozlamalar",
        developerLink: "Dasturchi Sahifasi",
        donate: "Dasturchiga Hissa Qo'shish"
    },
    ru: {
        settings: "Настройки",
        developerLink: "Страница Разработчика",
        donate: "Пожертвовать Разработчику"
    },
    fr: {
        settings: "Paramètres",
        developerLink: "Page du Développeur",
        donate: "Faire un Don au Développeur"
    },
    fil: {
        settings: "Mga Setting",
        developerLink: "Pahina ng Developer",
        donate: "Magbigay sa Developer"
    },
    id: {
        settings: "Pengaturan",
        developerLink: "Halaman Pengembang",
        donate: "Donasi ke Pengembang"
    },
    hi: {
        settings: "सेटिंग्स",
        developerLink: "डेवलपर पेज",
        donate: "डेवलपर को दान करें"
    },
    it: {
        settings: "Impostazioni",
        developerLink: "Pagina dello Sviluppatore",
        donate: "Dona al Sviluppatore"
    },
    fa: {
        settings: "تنظیمات",
        developerLink: "صفحه توسعه‌دهنده",
        donate: "کمک به توسعه‌دهنده"
    },
    ar: {
        settings: "الإعدادات",
        developerLink: "صفحة المطور",
        donate: "التبرع للمطور"
    }
};

// 브라우저 언어 가져오기
const userLang = navigator.language || navigator.userLanguage;
const langCode = userLang.split('-')[0];

// 언어 설정
const lang = translations[langCode] || translations['en'];

document.getElementById("settings").textContent = lang.settings;
document.getElementById("developer").textContent = lang.developerLink;
document.getElementById("donate").textContent = lang.donate;

// 각 메뉴 클릭 이벤트
document.getElementById("settings").addEventListener("click", function() {
    chrome.runtime.openOptionsPage();
});

document.getElementById("developer").addEventListener("click", function() {
    chrome.tabs.create({ url: "https://linktr.ee/Jelly_King" });
});

document.getElementById("donate").addEventListener("click", function() {
    chrome.tabs.create({ url: "https://buymeacoffee.com/madjellyparty" });
});