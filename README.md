🚛 TPM - Sistema de Gestión de Activos y Mantenimiento
Software integral diseñado para la digitalización del control de flota, gestión de Órdenes de Trabajo (OT) y generación de reportes automáticos de mantenimiento.

🛠️ Requisitos Previos
Asegúrese de tener instaladas las siguientes herramientas antes de iniciar el despliegue local:

Node.js (Versión LTS recomendada) - nodejs.org

Docker Desktop (Para orquestación de la base de datos) - docker.com

Git - git-scm.com

🚀 Instalación y Despliegue
Siga este flujo secuencial para poner en marcha el entorno de desarrollo:

1. Clonar el repositorio
Bash
git clone https://github.com/TU_USUARIO/TU_REPOSITORIO.git
cd TU_REPOSITORIO
2. Infraestructura (Database)
Asegúrese de que el motor de Docker esté en ejecución y levante el contenedor de la base de datos:

Bash
docker-compose up -d
3. Configuración del Backend (Servidor)
Acceda al directorio del servidor, instale dependencias y ejecute las migraciones de Prisma:

Bash
cd backend
npm install
npx prisma migrate dev --name init
npm run start:dev
El servidor estará disponible en el puerto configurado (por defecto 3000).

4. Configuración del Frontend (Interfaz)
En una nueva terminal, instale las dependencias de la UI y levante el servidor de desarrollo:

Bash
cd frontend
npm install
npm start
Acceso local: http://localhost:4200

📖 Guía de Uso Rápido
Configuración Inicial: Acceda al módulo de Configuración para poblar los diccionarios base (Tipos de equipo, Marcas, Modelos).

Gestión de Flota: Registre las unidades en el Maestro de Flota.

Operaciones: Genere Órdenes de Trabajo vinculadas a los equipos registrados.

Analytics: Utilice las funciones de "Exportar a Excel" y "Descargar Hoja de Vida" (PDF) para obtener reportes técnicos.

⚠️ Notas Técnicas para Colaboradores
Persistencia: La base de datos depende del estado del contenedor Docker. No detenga el servicio docker-compose mientras el backend esté en ejecución.

Hot Reload: Tanto el backend (NestJS) como el frontend cuentan con recarga en caliente. Los cambios en el código se reflejarán automáticamente.

Soporte: En caso de errores de conexión con la base de datos, verifique las variables de entorno (.env) y el estado de los volúmenes en Docker.

🗺️ Roadmap / Próximos Pasos
Fase 9: Gestión de Usuarios. Implementación de RBAC (Role-Based Access Control) y módulos de perfil de usuario para entornos colaborativos.
