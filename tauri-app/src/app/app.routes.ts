import { Routes } from '@angular/router';
import { CalibrationLightComponent } from './calibration-light.component';
import { ModelCopierComponent } from './model-copier.component';
import { ParameterConfigComponent } from './parameter-config.component';
import { SettingsComponent } from './settings.component';

export const routes: Routes = [
  { path: 'teach', component: ParameterConfigComponent },
  { path: 'calibrate', component: CalibrationLightComponent },
  { path: 'copier', component: ModelCopierComponent },
  { path: 'settings', component: SettingsComponent },
  { path: '', redirectTo: 'teach', pathMatch: 'full' }
];
