ÍCONE DO INSTALADOR — INSTRUÇÕES
=================================

Para gerar o instalador com ícone personalizado, coloque aqui:

  icon.ico  — Ícone do Windows (256x256 + 128x128 + 64x64 + 32x32 pixels)
               Formato .ico multi-resolução

  icon.png  — PNG 512x512 (usado pelo electron-builder para gerar .ico se necessário)

CONVERTER PNG → ICO
-------------------
Opção online: https://convertio.co/png-ico/
Opção offline: ImageMagick (convert icon.png -resize 256x256 icon.ico)

REQUISITO
---------
O arquivo icon.ico é OBRIGATÓRIO para o build com NSIS.
Se não tiver ícone, remova as linhas "icon" do electron/package.json.
