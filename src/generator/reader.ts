/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import https from 'https';
import {Observable} from 'rxjs';

import {JsonLdOntology} from '../lib/jsonld';

export function load(
    version: string, file = 'schema'): Observable<JsonLdOntology> {
  return new Observable<JsonLdOntology>(subscriber => {
    https
        .get(
            `https://schema.org/version/${version}/${file}.jsonld`,
            response => {
              const data: string[] = [];

              response.on('data', (chunkB: Buffer) => {
                const chunk = chunkB.toString('utf-8');
                data.push(chunk);
              });

              response.on('end', () => {
                const ontology = JSON.parse(data.join('')) as JsonLdOntology;
                subscriber.next(ontology);
                subscriber.complete();
              });

              response.on('error', error => {
                subscriber.error(error);
              });
            })
        .on('error', e => subscriber.error(e));
  });
}
