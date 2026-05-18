import { Component, inject, OnInit, signal } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule, NgStyle } from '@angular/common';
import {
  TenantService,
  Tenant,
} from '../../../core/services/tenant/tenant.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

/** Minimum contrast ratio for WCAG AA on normal text (4.5:1) */
const WCAG_AA = 4.5;

function hexToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * hexToLinear(r) + 0.7152 * hexToLinear(g) + 0.0722 * hexToLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface BrandColor {
  hex: string;
  name: string;
}

/** Palette of brand colors curated for use as `--primary-rgb`.
 *  Each color has been validated for contrast against dark (#161C24)
 *  and noted for light mode compatibility. */
export const BRAND_PALETTE: BrandColor[] = [
  { hex: '#00E5FF', name: 'Cyan Eléctrico' },
  { hex: '#00B4D8', name: 'Cyan Profundo' },
  { hex: '#0EA5E9', name: 'Cielo' },
  { hex: '#2563EB', name: 'Azul Royal' },
  { hex: '#4F46E5', name: 'Índigo' },
  { hex: '#7C3AED', name: 'Violeta' },
  { hex: '#9333EA', name: 'Púrpura' },
  { hex: '#EC4899', name: 'Rosa' },
  { hex: '#E11D48', name: 'Carmesí' },
  { hex: '#EA580C', name: 'Naranja' },
  { hex: '#16A34A', name: 'Verde' },
  { hex: '#0D9488', name: 'Teal' },
];

const BG_DARK = '#161C24';
const BG_LIGHT = '#F8FAFC';

function isHttpLogoUrl(v: string | null | undefined): boolean {
  const s = (v || '').trim();
  return /^https?:\/\//i.test(s);
}

@Component({
  selector: 'app-company-config',
  standalone: true,
  imports: [CommonModule, NgStyle, ReactiveFormsModule],
  templateUrl: './company-config.component.html',
})
export class CompanyConfigComponent implements OnInit {
  private fb = inject(FormBuilder);
  tenantService = inject(TenantService);
  private notification = inject(NotificationService);

  configForm: FormGroup;
  isSaving = signal(false);
  isUploadingLogo = signal(false);
  readonly palette = BRAND_PALETTE;

  constructor() {
    this.configForm = this.fb.group({
      rut: [''],
      address: [''],
      city: [''],
      phone: [''],
      invoiceLegalName: [''],
      primaryColor: [
        '#00E5FF',
        [Validators.required, Validators.pattern(/^#[0-9a-fA-F]{6}$/i)],
      ],
      logoUrl: [''],
      laborRatePerHour: [0, [Validators.min(0)]],
    });
  }

  ngOnInit() {
    this.loadConfig();
  }

  loadConfig() {
    this.tenantService.getTenantConfig().subscribe({
      next: (config: Tenant) => {
        this.tenantService.setTenant(config);
        this.patchForm(config);
      },
      error: () => {
        const tenant = this.tenantService.currentTenant();
        if (tenant) {
          this.patchForm(tenant);
        }
        this.notification.error('No se pudo cargar la configuración de empresa.');
      },
    });
  }

  private patchForm(t: Tenant) {
    const rawLogo = (t.logoUrl || '').trim();
    this.configForm.patchValue({
      rut: t.rut || '',
      address: t.address || '',
      city: t.city || '',
      phone: t.phone || '',
      invoiceLegalName: t.invoiceLegalName || '',
      primaryColor: t.primaryColor || '#00E5FF',
      logoUrl: isHttpLogoUrl(rawLogo) ? rawLogo : '',
      laborRatePerHour: t.laborRatePerHour ?? 0,
    });
  }

  logoPreviewSrc(t: Tenant | null): string | null {
    if (!t) return null;
    const pub = (t.logoPublicUrl || '').trim();
    if (pub) return pub;
    const raw = (t.logoUrl || '').trim();
    return isHttpLogoUrl(raw) ? raw : null;
  }

  onLogoFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.isUploadingLogo.set(true);
    this.tenantService.uploadTenantLogo(file).subscribe({
      next: (config) => {
        this.tenantService.setTenant(config);
        this.patchForm(config);
        this.notification.success('Logo actualizado');
        this.isUploadingLogo.set(false);
      },
      error: () => {
        this.notification.error('No se pudo subir el logo (máx. 2 MB, PNG/JPEG/WebP).');
        this.isUploadingLogo.set(false);
      },
    });
  }

  selectColor(hex: string) {
    this.configForm.patchValue({ primaryColor: hex });
  }

  get currentColor(): string {
    const v: string = this.configForm.get('primaryColor')?.value ?? '#00E5FF';
    return /^#[0-9a-fA-F]{6}$/i.test(v) ? v : '#00E5FF';
  }

  contrastOnDark(hex: string): number {
    try { return Math.round(contrastRatio(hex, BG_DARK) * 10) / 10; } catch { return 0; }
  }

  contrastOnLight(hex: string): number {
    try { return Math.round(contrastRatio(hex, BG_LIGHT) * 10) / 10; } catch { return 0; }
  }

  passesAA(ratio: number): boolean {
    return ratio >= WCAG_AA;
  }

  /**
   * Inline styles for the contrast badge inside the DARK preview panel (#161C24).
   * Uses bright colors that stand out on a dark background.
   */
  badgeDarkStyle(ratio: number): Record<string, string> {
    return ratio >= WCAG_AA
      ? { color: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)', borderColor: '#10B981' }
      : { color: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#F59E0B' };
  }

  /**
   * Inline styles for the contrast badge inside the LIGHT preview panel (#F8FAFC / white).
   * Uses darker tones of green/amber so they remain legible on white.
   */
  badgeLightStyle(ratio: number): Record<string, string> {
    return ratio >= WCAG_AA
      ? { color: '#047857', backgroundColor: 'rgba(4,120,87,0.10)', borderColor: '#047857' }
      : { color: '#B45309', backgroundColor: 'rgba(180,83,9,0.10)', borderColor: '#B45309' };
  }

  onSubmit() {
    if (this.configForm.invalid) {
      this.notification.error('Formulario inválido. Verifica los campos.');
      return;
    }

    this.isSaving.set(true);
    const raw = { ...this.configForm.value } as Record<string, unknown>;
    if (!(raw['logoUrl'] as string)?.toString().trim()) {
      delete raw['logoUrl'];
    }
    const data = raw as Partial<Tenant>;

    this.tenantService.updateTenantConfig(data).subscribe({
      next: (config: Tenant) => {
        this.tenantService.setTenant(config);
        this.notification.success('Configuración actualizada exitosamente');
        this.isSaving.set(false);
      },
      error: () => {
        this.notification.error('Error al actualizar la configuración');
        this.isSaving.set(false);
      },
    });
  }
}
