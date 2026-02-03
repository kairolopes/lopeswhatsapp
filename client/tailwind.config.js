/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: "#128C7E",
                secondary: "#075E54",
                chat: "#efeae2",
                "chat-dark": "#0b141a",
                "chat-bubble-in": "#d9fdd3",
                "chat-bubble-out": "#ffffff",
            }
        },
    },
    plugins: [],
}
