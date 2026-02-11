/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{vue,js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: '#7B6699',
                secondary: '#F3F0F5',
                border: '#E0D8E8',
                income: '#5D8C71',
                expense: '#BA5C5C',
            },
            fontFamily: {
                sans: ['"Noto Sans TC"', 'system-ui', 'sans-serif'],
                serif: ['"Noto Serif TC"', 'serif'],
            },
            backgroundImage: {
                'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))',
            }
        },
    },
    plugins: [],
}
