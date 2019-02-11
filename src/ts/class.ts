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
import {createEnumDeclaration, createEnumMember, createIntersectionTypeNode, createKeywordTypeNode, createModifiersFromModifierFlags, createParenthesizedType, createStringLiteral, createTypeAliasDeclaration, createTypeLiteralNode, createTypeReferenceNode, createUnionTypeNode, DeclarationStatement, EnumDeclaration, ModifierFlags, Statement, SyntaxKind, TypeAliasDeclaration, TypeNode} from 'typescript';

import {Log} from '../logging';
import {TObject, TPredicate, TSubject} from '../triples/triple';
import {UrlNode} from '../triples/types';
import {GetComment, GetSubClassOf, IsSupersededBy} from '../triples/wellKnown';

import {Context} from './context';
import {EnumValue} from './enum';
import {Property, TypeProperty} from './property';
import {arrayOf} from './util/arrayof';
import {withComments} from './util/comments';
import {toClassName} from './util/names';

/** Maps fully qualified IDs of each Class to the class itself. */
export type ClassMap = Map<string, Class>;

/**
 * Represents a "Class" in Schema.org, except in cases where it is better
 * described by Builtin (i.e. is a DataType).
 *
 * In TypeScript, this corresponds to a collection of declarations:
 * 1. If the class has enum values, an Enum declaration.
 * 2. If the class has properties, the properties in an object literal.
 * 3. If the class has children,
 *        a type union over all children.
 *    otherwise, a "type" property.
 */
export class Class {
  private _comment?: string;
  private readonly children: Class[] = [];
  private readonly parents: Class[] = [];
  private readonly _props: Property[] = [];
  private readonly _enums: EnumValue[] = [];
  private readonly _supersededBy: Class[] = [];

  private aliasesBuiltin(): boolean {
    for (const parent of this.parents) {
      if (parent instanceof Builtin || parent.aliasesBuiltin()) {
        return true;
      }
    }
    return false;
  }

  get deprecated() {
    return this._supersededBy.length > 0;
  }

  private get comment() {
    if (!this.deprecated) return this._comment;
    const deprecated = `@deprecated Use ${
        this._supersededBy.map(c => c.className()).join(' or ')} instead.`;
    return this._comment ? `${this._comment}\n${deprecated}` : deprecated;
  }

  private get isLeaf(): boolean {
    return this.children.length === 0 && !this.aliasesBuiltin();
  }

  private properties() {
    this._props.sort((a, b) => CompareKeys(a.key, b.key));
    return this.isLeaf ? [new TypeProperty(this.subject), ...this._props] :
                         this._props;
  }

  protected baseName() {
    return toClassName(this.subject) + 'Base';
  }
  private enumName() {
    return toClassName(this.subject) + 'Enum';
  }
  private className() {
    return toClassName(this.subject);
  }

  constructor(readonly subject: TSubject) {}
  add(value: {Predicate: TPredicate; Object: TObject},
      classMap: ClassMap): boolean {
    const c = GetComment(value);
    if (c) {
      if (this._comment) {
        Log(`Duplicate comments provided on class ${
            this.subject.toString()}. It will be overwritten.`);
      }
      this._comment = c.comment;
      return true;
    }
    const s = GetSubClassOf(value);
    if (s) {
      const parentClass = classMap.get(s.subClassOf.toString());
      if (parentClass) {
        this.parents.push(parentClass);
        parentClass.children.push(this);
      } else {
        throw new Error(`Couldn't find parent of ${
            this.subject.toHumanString()}, ${s.subClassOf.toString()}`);
      }
      return true;
    }

    if (IsSupersededBy(value.Predicate)) {
      const supersededBy = classMap.get(value.Object.toString());
      if (!supersededBy) {
        throw new Error(`Couldn't find class ${
            value.Object.toString()}, which supersedes class ${
            this.subject.toHumanString()}`);
      }
      this._supersededBy.push(supersededBy);
      return true;
    }

    return false;
  }
  addProp(p: Property) {
    this._props.push(p);
  }
  addEnum(e: EnumValue) {
    this._enums.push(e);
  }

  private baseNode(skipDeprecatedProperties: boolean, context: Context):
      TypeNode {
    // Properties part.
    const propLiteral = createTypeLiteralNode(
        this.properties()
            .filter(
                property => !property.deprecated || !skipDeprecatedProperties)
            .map(prop => prop.toNode(context)));

    const parentTypes = this.parents.map(
        parent => createTypeReferenceNode(parent.baseName(), []));
    const parentNode = parentTypes.length === 0 ?
        null :
        parentTypes.length === 1 ?
        parentTypes[0] :
        createParenthesizedType(createIntersectionTypeNode(parentTypes));

    if (parentNode && propLiteral.members.length > 0) {
      return createIntersectionTypeNode([parentNode, propLiteral]);
    } else if (parentNode) {
      return parentNode;
    } else if (propLiteral.members.length > 0) {
      return propLiteral;
    } else {
      return createKeywordTypeNode(SyntaxKind.NeverKeyword);
    }
  }

  private baseDecl(skipDeprecatedProperties: boolean, context: Context):
      TypeAliasDeclaration {
    const baseNode = this.baseNode(skipDeprecatedProperties, context);

    return createTypeAliasDeclaration(
        /*decorators=*/[], /*modifiers=*/[], this.baseName(),
        /*typeParameters=*/[], baseNode);
  }

  private nonEnumType(context: Context): TypeNode {
    this.children.sort((a, b) => CompareKeys(a.subject, b.subject));
    const children = this.children.map(
        child =>
            createTypeReferenceNode(child.className(), /*typeArguments=*/[]));

    const childrenNode = children.length === 0 ?
        null :
        children.length === 1 ?
        children[0] :
        createParenthesizedType(createUnionTypeNode(children));

    if (childrenNode) {
      return createUnionTypeNode([
        createIntersectionTypeNode([
          createTypeLiteralNode(
              [new TypeProperty(this.subject).toNode(context)]),
          createTypeReferenceNode(this.baseName(), /*typeArguments=*/[])
        ]),
        childrenNode
      ]);
    } else {
      return createTypeReferenceNode(this.baseName(), /*typeArguments=*/[]);
    }
  }

  private totalType(context: Context): TypeNode {
    const isEnum = this._enums.length > 0;

    if (isEnum) {
      return createUnionTypeNode([
        createTypeReferenceNode(this.enumName(), []),
        createParenthesizedType(this.nonEnumType(context)),
      ]);
    } else {
      return this.nonEnumType(context);
    }
  }

  private enumDecl(): EnumDeclaration|undefined {
    if (this._enums.length === 0) return undefined;
    this._enums.sort((a, b) => CompareKeys(a.value, b.value));

    return createEnumDeclaration(
        /* decorators= */[],
        createModifiersFromModifierFlags(ModifierFlags.Export), this.enumName(),
        this._enums.map(e => e.toNode()));
  }

  toNode(context: Context, skipDeprecatedProperties: boolean) {
    const typeValue: TypeNode = this.totalType(context);
    const declaration = withComments(
        this.comment,
        createTypeAliasDeclaration(
            /* decorators = */[],
            createModifiersFromModifierFlags(ModifierFlags.Export),
            this.className(),
            [],
            typeValue,
            ));

    return arrayOf<Statement>(
        this.enumDecl(), this.baseDecl(skipDeprecatedProperties, context),
        declaration);
  }
}

/**
 * Represents a DataType. A "Native" Schema.org object that is best represented
 * in JSON-LD and JavaScript as a typedef to a native type.
 */
export class Builtin extends Class {
  constructor(
      url: string, private readonly equivTo: string,
      protected readonly doc: string) {
    super(UrlNode.Parse(url));
  }

  toNode(): DeclarationStatement[] {
    return [
      withComments(
          this.doc,
          createTypeAliasDeclaration(
              /*decorators=*/[],
              createModifiersFromModifierFlags(ModifierFlags.Export),
              this.baseName(),
              /*typeParameters=*/[],
              createTypeReferenceNode(this.equivTo, []))),
    ];
  }

  protected baseName() {
    return (this.subject as UrlNode /* Just Constructed */).name!;
  }
}
export class BooleanEnum extends Builtin {
  constructor(
      url: string, private trueUrl: string, private falseUrl: string,
      doc: string) {
    super(url, '', doc);
  }

  toNode(): DeclarationStatement[] {
    return [withComments(
        this.doc,
        createEnumDeclaration(
            /*decotrators=*/[],
            createModifiersFromModifierFlags(ModifierFlags.Export),
            this.baseName(), [
              createEnumMember('True', createStringLiteral(this.trueUrl)),
              createEnumMember('False', createStringLiteral(this.falseUrl)),
            ]))];
  }
}

/**
 * Defines a Sort order between Class declarations.
 *
 * DataTypes come first, followed by all regular classes. Within each group,
 * class names are ordered alphabetically in UTF-16 code units order.
 */
export function Sort(a: Class, b: Class): number {
  if (a instanceof Builtin) {
    if (b instanceof Builtin) {
      return a.subject.toHumanString().localeCompare(b.subject.toHumanString());
    } else {
      return -1;
    }
  } else if (b instanceof Builtin) {
    return +1;
  } else {
    return CompareKeys(a.subject, b.subject);
  }
}

function CompareKeys(a: TSubject, b: TSubject): number {
  const byName = a.toHumanString().localeCompare(b.toHumanString());
  if (byName !== 0) return byName;

  return a.toString().localeCompare(b.toString());
}
