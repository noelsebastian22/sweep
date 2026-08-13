import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    // withComponentInputBinding lets the live scan screen take its :id as a signal input
    // rather than subscribing to ActivatedRoute — no RxJS, per the stack rules.
    provideRouter(routes, withViewTransitions(), withComponentInputBinding()),
  ],
};
