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
import {createArrayTypeNode, createKeywordTypeNode, createLiteralTypeNode, createPropertySignature, createStringLiteral, createToken, createTypeLiteralNode, createTypeReferenceNode, createUnionTypeNode, PropertySignature, SyntaxKind, TypeNode} from 'typescript';

import {withComments} from './comments';
import {JsonLdGraphItem, LD_DOMAIN_INCLUDES, LD_ID, LD_RANGE_INCLUDES, ToArray} from './jsonld';
import {toScopedName} from './names';
import {PreferredLanguage} from './settings';
import {Class, ClassMap} from './toClass';
// import {TObject, TPredicate, TSubject} from './triple';
import {GetComments, GetTypes} from './wellKnown';

export class PropertyType {
  readonly INSTANCE = 'PropertyType';

  comment?: string;
  readonly types: Class[] = [];
  constructor(readonly item: JsonLdGraphItem) {}

  init(map: ClassMap): boolean {
    const comments = GetComments(this.item, PreferredLanguage());
    if (comments.length > 1 || (this.comment && comments.length > 0)) {
      console.error(
          `Duplicate comments provided on property ${this.item[LD_ID]}.`);
    }
    if (comments.length > 0) {
      this.comment = comments[0];
    }

    const rangeIncludes = ToArray(this.item[LD_RANGE_INCLUDES]);
    this.types.push(...rangeIncludes.map(ref => {
      const cls = map.get(ref[LD_ID]);
      if (!cls) throw new Error(`Class with ID ${ref[LD_ID]} not found.`);
      return cls;
    }));

    const domainIncludes = ToArray(this.item[LD_DOMAIN_INCLUDES]);
    for (const domain of domainIncludes) {
      const cls = map.get(domain[LD_ID]);
      if (!cls) {
        throw new Error(
            `Could not find class for ${this.item[LD_ID]}, ${domain[LD_ID]}.`);
      }
      cls.addProp(new Property(toScopedName(this.item), this));
    }

    return false;
  }
}
export class StringLiteralType {
  readonly INSTANCE = 'StringLiteralType';

  constructor(readonly value: string) {}
}

export class Property {
  constructor(
      private readonly key: string,
      private readonly type: PropertyType|StringLiteralType) {}

  required() {
    return this.key.startsWith('@');
  }

  private typeNode() {
    const node = this.scalarTypeNode();
    return this.key.startsWith('@') ?
        node :
        createUnionTypeNode([node, createArrayTypeNode(node)]);
  }

  private scalarTypeNode() {
    if (this.type instanceof StringLiteralType) {
      return createLiteralTypeNode(createStringLiteral(this.type.value));
    }

    const typeNodes = this.type.types.map(
        type => createTypeReferenceNode(toScopedName(type.item), []));
    switch (typeNodes.length) {
      case 0:
        return createKeywordTypeNode(SyntaxKind.NeverKeyword);
      case 1:
        return typeNodes[0];
      default:
        return createUnionTypeNode(typeNodes);
    }
  }

  toNode(): PropertySignature {
    return withComments(
        (this.type instanceof PropertyType) ? this.type.comment : undefined,
        createPropertySignature(
            /* modifiers= */[],
            createStringLiteral(this.key),
            this.required() ? undefined : createToken(SyntaxKind.QuestionToken),
            /*typeNode=*/this.typeNode(),
            /*initializer=*/undefined,
            ));
  }
}
