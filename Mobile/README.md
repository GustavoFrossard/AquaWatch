# AquaWatch Mobile (Expo + WebView)

Aplicativo mobile (Android e iOS) que abre seu webapp dentro de um `WebView`.

## O que ja vem pronto

- Abertura direta da URL do webapp
- Loading durante carregamento
- Tratamento de erro de conexao com botao de retry
- Pull-to-refresh
- Suporte a botao voltar do Android para navegar no historico do WebView
- Configuracao de build com EAS (APK no perfil preview)

## Configurar URL do webapp

Edite `app.json`:

```json
"extra": {
  "webAppUrl": "https://SEU-WEBAPP-AQUI.com"
}
```

## Rodar localmente

1. Entre na pasta do app:

```bash
cd Mobile
```

2. Instale dependencias:

```bash
npm install
```

3. Inicie o Expo:

```bash
npx expo start
```

4. Execute no dispositivo:
- Android: Expo Go ou emulador Android
- iOS: Expo Go (macOS + simulador opcional)

## Build Android/iOS com EAS

1. Login no Expo:

```bash
npx expo login
```

2. Configurar projeto EAS (primeira vez):

```bash
npx eas build:configure
```

3. Gerar APK (instalacao direta):

```bash
npx eas build -p android --profile preview
```

4. Gerar build Android para Play Store (AAB):

```bash
npx eas build -p android --profile production
```

5. Gerar build iOS:

```bash
npx eas build -p ios --profile production
```

## Publicacao (opcional)

- Android: `npx eas submit -p android --latest`
- iOS: `npx eas submit -p ios --latest`
