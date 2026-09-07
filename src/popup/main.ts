import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import 'weui/dist/style/weui.min.css'
import '../styles/design-system.css'
import './style.css'
import 'virtual:uno.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
