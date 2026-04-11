import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

const DEFAULT_DESC =
  'EAM / ERP multicontrato: flota, órdenes de trabajo, inventario multibodega y trazabilidad — BaseLogic para minería e industria pesada.';

/** Ruta (sin query) → título y descripción opcional para OG / pestaña. */
const ROUTE_SEO: Record<
  string,
  { title: string; description?: string }
> = {
  '/auth/login': {
    title: 'BaseLogic — Iniciar sesión',
    description: 'Accede al panel de gestión de activos y mantenimiento.',
  },
  '/auth/forgot-password': {
    title: 'BaseLogic — Recuperar contraseña',
    description: 'Solicita un enlace seguro para restablecer tu contraseña.',
  },
  '/auth/reset-password': {
    title: 'BaseLogic — Nueva contraseña',
    description: 'Define una nueva contraseña para tu cuenta.',
  },
  '/auth/activate': {
    title: 'BaseLogic — Activar cuenta',
    description: 'Activa tu usuario y define tu contraseña.',
  },
  '/app/dashboard': {
    title: 'BaseLogic — Inicio',
    description: DEFAULT_DESC,
  },
};

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly document = inject(DOCUMENT);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly siteName = 'BaseLogic';
  private readonly defaultTitle = 'BaseLogic — EAM / ERP industrial';
  private readonly logoPath = '/assets/BaseLogic_Logo.png';

  init(): void {
    this.applyDefaults();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.syncForCurrentUrl());
    this.syncForCurrentUrl();
  }

  private baseUrl(): string {
    return environment.siteUrl.replace(/\/$/, '');
  }

  private absoluteUrl(pathOrHref: string): string {
    if (pathOrHref.startsWith('http')) return pathOrHref;
    const path = pathOrHref.startsWith('/') ? pathOrHref : `/${pathOrHref}`;
    return `${this.baseUrl()}${path}`;
  }

  private currentPageUrl(): string {
    if (isPlatformBrowser(this.platformId) && typeof window !== 'undefined') {
      return `${window.location.origin}${window.location.pathname}`;
    }
    return `${this.baseUrl()}${this.router.url.split('?')[0]}`;
  }

  private applyDefaults(): void {
    const desc = DEFAULT_DESC;
    const imageUrl = this.absoluteUrl(this.logoPath);

    this.title.setTitle(this.defaultTitle);

    this.meta.updateTag({ name: 'description', content: desc });
    this.meta.updateTag({
      name: 'keywords',
      content:
        'EAM, TPM, mantenimiento, flota, inventario, ERP industrial, activos, BaseLogic',
    });
    this.meta.updateTag({ name: 'application-name', content: this.siteName });
    // Ajustar a noindex si el despliegue es solo intranet.
    this.meta.updateTag({ name: 'robots', content: 'index, follow' });
    this.meta.updateTag({ name: 'theme-color', content: '#09090b' });
    this.meta.updateTag({ name: 'color-scheme', content: 'dark' });

    this.meta.updateTag({ property: 'og:site_name', content: this.siteName });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:locale', content: 'es_CL' });
    this.meta.updateTag({
      property: 'og:image',
      content: imageUrl,
    });
    this.meta.updateTag({
      property: 'og:image:alt',
      content: 'Logo BaseLogic',
    });
    this.meta.updateTag({ property: 'og:image:type', content: 'image/png' });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:image:alt', content: 'Logo BaseLogic' });
  }

  private syncForCurrentUrl(): void {
    const path = this.router.url.split('?')[0];
    const match =
      ROUTE_SEO[path] ??
      (path.startsWith('/app/')
        ? { title: `${this.siteName} — Panel`, description: DEFAULT_DESC }
        : { title: this.defaultTitle, description: DEFAULT_DESC });

    const title = match.title;
    const description = match.description ?? DEFAULT_DESC;
    const pageUrl = this.currentPageUrl();
    const imageUrl = this.absoluteUrl(this.logoPath);

    this.title.setTitle(title);

    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: pageUrl });

    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:image', content: imageUrl });

    this.setCanonical(pageUrl);
  }

  private setCanonical(href: string): void {
    const head = this.document.head;
    let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      head.appendChild(link);
    }
    link.setAttribute('href', href);
  }
}
