import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
  private injector = inject(Injector);
  tenantService = inject(TenantService);
  private notification = inject(NotificationService);

  configForm: FormGroup;
  isSaving = signal(false);
  isSavingPurchasesModal = signal(false);
  isUploadingLogo = signal(false);
  isUploadingLogoLight = signal(false);
  isUploadingPdfLogo = signal(false);
  readonly palette = BRAND_PALETTE;

  purchasesConfigModalOpen = signal(false);
  purchasesConfigDialog = viewChild<ElementRef<HTMLDialogElement>>('purchasesConfigDialog');

  constructor() {
    this.configForm = this.fb.group({
      rut: [''],
      address: [''],
      city: [''],
      phone: [''],
      invoiceLegalName: [''],
      ocPdfLegalNotice: ['', Validators.maxLength(4000)],
      primaryColor: [
        '#00E5FF',
        [Validators.required, Validators.pattern(/^#[0-9a-fA-F]{6}$/i)],
      ],
      logoUrl: [''],
      logoLightUrl: [''],
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
    const rawLogoLight = (t.logoLightUrl || '').trim();
    this.configForm.patchValue({
      rut: t.rut || '',
      address: t.address || '',
      city: t.city || '',
      phone: t.phone || '',
      invoiceLegalName: t.invoiceLegalName || '',
      ocPdfLegalNotice: t.ocPdfLegalNotice || '',
      primaryColor: t.primaryColor || '#00E5FF',
      logoUrl: isHttpLogoUrl(rawLogo) ? rawLogo : '',
      logoLightUrl: isHttpLogoUrl(rawLogoLight) ? rawLogoLight : '',
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

  logoLightPreviewSrc(t: Tenant | null): string | null {
    if (!t) return null;
    const pub = (t.logoLightPublicUrl || '').trim();
    if (pub) return pub;
    const raw = (t.logoLightUrl || '').trim();
    return isHttpLogoUrl(raw) ? raw : null;
  }

  /** Vista previa del logo solo para PDFs de compras. */
  pdfLogoPreviewSrc(t: Tenant | null): string | null {
    if (!t) return null;
    const pub = (t.pdfLogoPublicUrl || '').trim();
    if (pub) return pub;
    const raw = (t.pdfLogoUrl || '').trim();
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

  onLogoLightFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.isUploadingLogoLight.set(true);
    this.tenantService.uploadTenantLogoLight(file).subscribe({
      next: (config) => {
        this.tenantService.setTenant(config);
        this.patchForm(config);
        this.notification.success('Logo para modo claro actualizado');
        this.isUploadingLogoLight.set(false);
      },
      error: () => {
        this.notification.error('No se pudo subir el logo modo claro (máx. 2 MB, PNG/JPEG/WebP).');
        this.isUploadingLogoLight.set(false);
      },
    });
  }

  clearMenuLogoLight(): void {
    this.isUploadingLogoLight.set(true);
    this.tenantService.updateTenantConfig({ logoLightUrl: '' }).subscribe({
      next: (config) => {
        this.tenantService.setTenant(config);
        this.patchForm(config);
        this.notification.success('Logo modo claro eliminado');
        this.isUploadingLogoLight.set(false);
      },
      error: () => {
        this.notification.error('No se pudo quitar el logo modo claro');
        this.isUploadingLogoLight.set(false);
      },
    });
  }

  onPurchasesPdfLogoFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.isUploadingPdfLogo.set(true);
    this.tenantService.uploadTenantPdfLogo(file).subscribe({
      next: (config) => {
        this.tenantService.setTenant(config);
        this.patchForm(config);
        this.notification.success('Logo para PDFs actualizado');
        this.isUploadingPdfLogo.set(false);
      },
      error: () => {
        this.notification.error('No se pudo subir el logo PDF (máx. 2 MB, PNG/JPEG/WebP).');
        this.isUploadingPdfLogo.set(false);
      },
    });
  }

  clearPurchasesPdfLogo(): void {
    this.isUploadingPdfLogo.set(true);
    this.tenantService.updateTenantConfig({ pdfLogoUrl: '' }).subscribe({
      next: (config) => {
        this.tenantService.setTenant(config);
        this.patchForm(config);
        this.notification.success('Logo de PDFs eliminado');
        this.isUploadingPdfLogo.set(false);
      },
      error: () => {
        this.notification.error('No se pudo quitar el logo de PDFs');
        this.isUploadingPdfLogo.set(false);
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

  openPurchasesConfigModal(): void {
    this.purchasesConfigModalOpen.set(true);
    afterNextRender(
      () => {
        const el = this.purchasesConfigDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  closePurchasesConfigModal(): void {
    const el = this.purchasesConfigDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.purchasesConfigModalOpen.set(false);
    }
  }

  onPurchasesConfigDialogClose(): void {
    this.purchasesConfigModalOpen.set(false);
  }

  /** Persiste solo razón social + aviso PDF OC (sin depender del «Guardar cambios» del pie). */
  savePurchasesFromModal(): void {
    const noticeCtrl = this.configForm.get('ocPdfLegalNotice');
    const legalCtrl = this.configForm.get('invoiceLegalName');
    if (!noticeCtrl || !legalCtrl) return;
    if (noticeCtrl.invalid) {
      noticeCtrl.markAsTouched();
      this.notification.error('Revisa el aviso legal (máximo 4000 caracteres).');
      return;
    }
    this.isSavingPurchasesModal.set(true);
    this.tenantService
      .updateTenantConfig({
        invoiceLegalName: (legalCtrl.value as string) ?? '',
        ocPdfLegalNotice: (noticeCtrl.value as string) ?? '',
      })
      .subscribe({
        next: (config: Tenant) => {
          this.tenantService.setTenant(config);
          this.patchForm(config);
          this.notification.success('Compras y aviso del PDF guardados en el servidor');
          this.isSavingPurchasesModal.set(false);
          this.closePurchasesConfigModal();
        },
        error: () => {
          this.notification.error('No se pudo guardar la configuración de compras');
          this.isSavingPurchasesModal.set(false);
        },
      });
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
    if (!(raw['logoLightUrl'] as string)?.toString().trim()) {
      delete raw['logoLightUrl'];
    }
    const data = raw as Partial<Tenant>;

    this.tenantService.updateTenantConfig(data).subscribe({
      next: (config: Tenant) => {
        this.tenantService.setTenant(config);
        this.notification.success('Configuración actualizada exitosamente');
        this.closePurchasesConfigModal();
        this.isSaving.set(false);
      },
      error: () => {
        this.notification.error('Error al actualizar la configuración');
        this.isSaving.set(false);
      },
    });
  }
}
