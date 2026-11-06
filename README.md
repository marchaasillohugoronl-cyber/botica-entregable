# Nova Salud · React + Vite + MongoDB Atlas

Inventario y ventas para una botica con **un administrador**. Frontend sencillo en React y CSS, backend JavaScript en Vercel Functions y MongoDB en MongoDB Atlas. No se usa un ORM ni se conecta la base de datos desde el navegador.

## Qué incluye

- Inicio y cierre de sesión con contraseña protegida mediante scrypt.
- Sesiones de 8 horas en MongoDB; cookies HttpOnly, SameSite=Strict y Secure en producción.
- Límite compartido de 20 intentos de acceso cada 15 minutos.
- Productos, reposición, alertas de stock y validaciones en el servidor y la base de datos.
- Ventas transaccionales: stock, venta y auditoría se guardan juntos o se revierten juntos.
- Transacciones con detección de conflictos para evitar sobreventa entre dispositivos.
- Control de versión para impedir que un formulario antiguo sobrescriba cambios de stock.
- Identificador estable de venta para reintentar sin duplicar operaciones.
- Importes en céntimos y precios comprobados contra el catálogo del servidor.
- Historial paginado (50 ventas por página), resumen diario en horario de Lima.
- Protección de origen en operaciones de escritura, filtros construidos en el servidor y cabeceras de seguridad.

La base empieza **vacía**, sin productos de demostración ni contraseñas predeterminadas. Los datos antiguos de localStorage no se importan automáticamente.

## 1. Crear la base en MongoDB Atlas

Crea un clúster en Atlas, un usuario de base de datos y autoriza las direcciones de salida del backend en **Network Access**. Copia la URI de **Connect → Drivers → Node.js** y sustituye usuario y contraseña (codifica los caracteres especiales de la contraseña para una URI).

La aplicación utiliza el driver oficial `mongodb`, conexiones TLS verificadas y un pool reutilizable por instancia. Necesita transacciones: Atlas o un replica set local; un servidor MongoDB standalone no es compatible. Usa una base distinta para desarrollo y pruebas.

Referencias: [Conexión con MongoClient](https://www.mongodb.com/docs/drivers/node/current/connect/mongoclient/) y [transacciones](https://www.mongodb.com/docs/drivers/node/v6.x/crud/transactions/).

## 2. Configurar y ejecutar localmente

Usa Node.js **22.12 o superior de la rama 22**, la misma versión configurada para Vercel.

```bash
npm ci
cp .env.example .env.local
npm run admin:hash
```

El último comando pide una contraseña de entre 14 y 256 caracteres con entrada oculta. Guarda la contraseña en tu gestor de contraseñas y copia únicamente el hash generado a `ADMIN_PASSWORD_HASH`.

Edita `.env.local`:

| Variable              | Valor                                        |
| --------------------- | -------------------------------------------- |
| `MONGODB_URI`         | URI `mongodb+srv://...` de Atlas.            |
| `MONGODB_DB`          | Nombre de la base, por ejemplo `nova_salud`. |
| `ADMIN_USERNAME`      | Usuario del administrador.                   |
| `ADMIN_PASSWORD_HASH` | Hash generado por `npm run admin:hash`.      |
| `APP_ORIGIN`          | `http://localhost:5173` en desarrollo.       |

Ninguna variable lleva el prefijo `VITE_`. `.env.local` está ignorado por Git. Nunca subas credenciales ni compartas la conexión en un chat.

```bash
npm run db:migrate
npm run dev
```

Abre `http://localhost:5173`. Vite sirve también la API local, por lo que no hace falta iniciar otro proceso. Reinicia el servidor si cambias las variables. La inicialización crea colecciones, aplica validadores e índices y puede repetirse sin borrar datos. Sus pasos no son una transacción; si falla, corrige la causa y vuelve a ejecutarla. No importa datos de PostgreSQL: si tienes datos allí, conserva la base original y prepara una transferencia antes del cambio de producción. No se ejecuta automáticamente durante el build.

`npm run preview` sirve solo el frontend compilado; para probar el sistema completo usa `npm run dev` o un despliegue de Vercel.

## 3. Desplegar en Vercel

1. Importa el repositorio y selecciona la carpeta con este `package.json` como raíz.
2. Usa el preset **Vite**, Node.js **22.x**, `npm run build` y salida `dist`. La API se encuentra en `api/index.js` y Vercel la despliega como función Node.js.
3. Configura las cinco variables anteriores en **Settings → Environment Variables** para Production. `APP_ORIGIN` debe ser la URL HTTPS exacta donde se utilizará la aplicación, por ejemplo `https://tu-botica.vercel.app`, sin rutas.
4. Ejecuta la migración una vez contra la base destinada a producción, desde un entorno seguro con su `MONGODB_URI`. Luego despliega.
5. Entra con el administrador, crea un producto y comprueba una venta, su stock y su historial antes de comenzar la operación real.

Para previews usa otra base de MongoDB Atlas y otro `APP_ORIGIN`. Accede siempre desde el dominio configurado; otros orígenes no pueden enviar escrituras. Alinea la región de la función con la de MongoDB Atlas para reducir latencia.

Referencia: [Variables de entorno de Vercel](https://vercel.com/docs/environment-variables).

### Permisos de base de datos

La inicialización necesita permisos para crear colecciones e índices y modificar validadores (`collMod`). Puedes ejecutarla con un usuario con roles `dbAdmin` y `readWrite` limitados a la base elegida. Para la aplicación usa otro usuario con `readWrite` solo sobre esa base, sin permisos administrativos del clúster. Si necesitas restricciones por colección, configura un rol personalizado.

## Pruebas

```bash
npm test
npm run build
```

Para verificar la API, autenticación y transacciones contra MongoDB real, configura `TEST_MONGODB_URI` en `.env.local` apuntando a un clúster **de pruebas** y ejecuta:

```bash
npm run test:integration
```

La prueba crea una base con nombre aleatorio `nova_test_...` y elimina solo esa base al terminar. Requiere permisos de creación, inicialización y eliminación sobre las bases de pruebas; usa credenciales exclusivas de pruebas. Cubre sesiones, CSRF por origen, validación, ventas concurrentes, reintentos idempotentes, rollback, precios manipulados, formularios obsoletos, paginación y límite de acceso.

## Operación

- Pulsa **Actualizar** para consultar cambios de otros dispositivos. Los precios del carrito se actualizan al hacerlo, salvo si hay una confirmación pendiente.
- Si una venta pierde la respuesta, usa **Reintentar confirmación**. El mismo identificador se conserva en sessionStorage al recargar esa pestaña. No crees otra venta ni cierres la pestaña hasta resolver la operación pendiente.
- Para cambiar la contraseña, genera otro hash, actualiza Vercel y vuelve a desplegar. Cambiar usuario o hash invalida las sesiones anteriores.
- El límite de acceso afecta al administrador completo. Un bloqueo termina a los 15 minutos; configura además límites perimetrales en Vercel si hay intentos abusivos.
- Configura la retención/restauración de MongoDB Atlas según tu plan y comprueba una restauración en una base separada. Conserva exportaciones según las necesidades del negocio.
- Los fallos internos registran un identificador de petición y un código; la API no devuelve consultas ni credenciales. Revisa los logs de Vercel y el uso de MongoDB Atlas.
- La auditoría técnica está en `inventory_audit`; registra creación, edición y descuento de stock por venta. Las ventas no se eliminan desde la aplicación.

## Archivos

- `src/App.jsx`: acceso del administrador.
- `src/Dashboard.jsx`: inventario, formulario, carrito e historial.
- `src/api.js`: peticiones HTTP.
- `api/index.js`: rutas HTTP, origen y manejo de errores.
- `server/auth.js`: contraseñas y sesiones.
- `server/inventory.js`: operaciones y transacciones.
- `server/db.js`: conexión MongoDB.
- `db/001_initial.js`: colecciones, validadores e índices iniciales.

## Alcance y puesta en marcha

El código incluye controles para operar el inventario con un administrador, pero la puesta en producción depende de configurar MongoDB Atlas y Vercel, aplicar la migración y verificar el despliegue real. No se incluyen facturación electrónica, devoluciones, lotes/vencimientos ni control de medicamentos regulados. Las ventas registradas son operaciones internas, no comprobantes fiscales. El catálogo se carga completo; para catálogos muy grandes será necesario paginar también productos.
