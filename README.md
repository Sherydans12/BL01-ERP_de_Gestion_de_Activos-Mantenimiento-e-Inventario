# 🚛 TPM - Sistema de Gestión de Activos y Mantenimiento

Bienvenido al repositorio de **TPM**. Este software está diseñado para digitalizar el control de flota, gestionar Órdenes de Trabajo (OT) y generar reportes automáticos de mantenimiento.

---

## 🛠️ Requisitos Previos

Para que el sistema funcione correctamente en tu entorno local, es necesario instalar:

1. **Node.js** (Versión LTS): [Descargar](https://nodejs.org/) - Entorno de ejecución para JavaScript.
2. **Docker Desktop**: [Descargar](https://www.docker.com/products/docker-desktop/) - Para la orquestación automatizada de la base de datos.
3. **Git**: [Descargar](https://git-scm.com/) - Control de versiones para clonar el proyecto.

---

## 🚀 Pasos para ejecutar el proyecto

Ejecuta los siguientes comandos en tu terminal (PowerShell, CMD o Bash) siguiendo este orden estricto:

### 1. Clonar el repositorio
```bash
git clone https://github.com/Sherydans12/BL01-ERP_de_Gestion_de_Activos-Mantenimiento-e-Inventario.git
cd BL01-ERP_de_Gestion_de_Activos-Mantenimiento-e-Inventario
```

### 2. Levantar la infraestructura (Docker)
Asegúrate de tener Docker Desktop abierto y ejecuta:
```bash
docker-compose up -d
```
*Esto desplegará la base de datos de forma automática.*

### 3. Configurar el Backend (Servidor)
Accede a la carpeta del servidor para instalar dependencias y sincronizar la base de datos:
```bash
cd backend
npm install
npx prisma migrate dev --name init
npm run start:dev
```
*El servidor estará activo cuando visualices el mensaje "Application is running".*

### 4. Configurar el Frontend (Interfaz)
En una **nueva terminal**, accede a la carpeta de la interfaz:
```bash
cd frontend
npm install
npm start
```
*El sistema se abrirá automáticamente en: http://localhost:4200*

---

## 📖 Guía de Uso Rápido

1. **Configuración**: Ve al módulo de Configuración y define los "Diccionarios" (Tipos de equipo, Marcas, etc.).
2. **Flota**: En el Maestro de Flota, registra las unidades (camiones, camionetas).
3. **Mantención**: Crea una Orden de Trabajo vinculada a un equipo registrado.
4. **Reportes**: Utiliza las funciones de "Exportar a Excel" y "Descargar Hoja de Vida" (PDF).

---

## ⚠️ Notas para el colaborador

* **Persistencia de procesos**: No cierres las terminales donde se ejecutan el Backend y el Frontend, de lo contrario el sistema se detendrá.
* **Base de Datos**: Docker debe estar iniciado **antes** de arrancar el Backend.
* **Depuración**: Si encuentras errores (texto en rojo), captura la pantalla y envíamela.

---

## 🗺️ Próximos Pasos (Fase 9)

El siguiente hito del proyecto se centrará en la **Gestión de Usuarios**:
* Implementación de roles y permisos (RBAC).
* Creación de perfiles de usuario individuales.
* Control de acceso por colaborador.
