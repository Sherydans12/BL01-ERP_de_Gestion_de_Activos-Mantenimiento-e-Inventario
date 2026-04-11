import { Component, OnInit, inject, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SeoService } from './core/seo/seo.service';
import { ToastComponent } from './shared/components/toast/toast.component';
import { ThemeService } from './core/services/theme/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private readonly seo = inject(SeoService);
  private readonly theme = inject(ThemeService);
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    // Sincronizar data-theme en el <html>: los effect() en servicios no siempre
    // actualizan el DOM de forma fiable; en el componente raíz sí.
    effect(() => {
      const dark = this.theme.isDark();
      if (!isPlatformBrowser(this.platformId)) return;
      const mode = dark ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', mode);
      const metaScheme = document.querySelector('meta[name="color-scheme"]');
      if (metaScheme) {
        metaScheme.setAttribute('content', dark ? 'dark' : 'light');
      }
    });
  }

  ngOnInit(): void {
    this.seo.init();
  }
}
