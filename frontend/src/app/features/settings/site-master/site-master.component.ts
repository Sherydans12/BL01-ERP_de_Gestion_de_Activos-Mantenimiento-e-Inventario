import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SitesService } from '../../../core/services/sites/sites.service';
import { Site } from '../../../core/services/tenant/tenant.service';

@Component({
  selector: 'app-site-master',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './site-master.component.html',
  styleUrls: ['./site-master.component.scss'],
})
export class SiteMasterComponent implements OnInit {
  sites = signal<Site[]>([]);
  isModalOpen = signal(false);
  editingSite = signal<Site | null>(null);

  formData = signal({ name: '', code: '', isActive: true });

  constructor(private sitesService: SitesService) {}

  ngOnInit() {
    this.loadSites();
  }

  loadSites() {
    this.sitesService.findAll().subscribe({
      next: (data) => this.sites.set(data),
      error: (err) => console.error('Error loadSites', err),
    });
  }

  openModal(site?: Site) {
    if (site) {
      this.editingSite.set(site);
      this.formData.set({ name: site.name, code: site.code, isActive: true });
    } else {
      this.editingSite.set(null);
      this.formData.set({ name: '', code: '', isActive: true });
    }
    this.isModalOpen.set(true);
  }

  closeModal() {
    this.isModalOpen.set(false);
    this.editingSite.set(null);
  }

  saveSite() {
    const data = this.formData();
    if (!data.name || !data.code) return alert('Completa todos los campos');

    const editing = this.editingSite();
    if (editing) {
      this.sitesService.update(editing.id, data).subscribe({
        next: () => {
          this.loadSites();
          this.closeModal();
        },
        error: (err) => alert(err.error?.message || 'Error al actualizar'),
      });
    } else {
      this.sitesService.create(data).subscribe({
        next: () => {
          this.loadSites();
          this.closeModal();
        },
        error: (err) => alert(err.error?.message || 'Error al crear'),
      });
    }
  }

  deleteSite(id: string) {
    if (confirm('¿Estás seguro de eliminar esta faena?')) {
      this.sitesService.remove(id).subscribe({
        next: () => this.loadSites(),
        error: (err) => alert(err.error?.message || 'Error al eliminar'),
      });
    }
  }
}
