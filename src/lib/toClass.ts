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
import {createEnumDeclaration, createEnumMember, createIntersectionTypeNode, createKeywordTypeNode, createModifiersFromModifierFlags, createParenthesizedType, createStringLiteral, createTypeAliasDeclaration, createTypeLiteralNode, createTypeReferenceNode, createUnionTypeNode, EnumDeclaration, ModifierFlags, Statement, SyntaxKind, TypeAliasDeclaration, TypeNode} from 'typescript';

import {withComments} from './comments';
import {JsonLdGraphItem, LD_COMMENT, LD_ID, LD_LABEL, LD_TYPES} from './jsonld';
import {toEnumMemberName, toScopedName} from './names';
import {IsVerbose, PreferredLanguage} from './settings';
import {Property, PropertyType, StringLiteralType} from './toProperty';
import {GetComments, GetSubClassOf, GetTypes, IsClassType, IsDataType, IsPropertyType} from './wellKnown';

export type ClassMap = Map<string, Class>;

function arrayOf<T>(...args: Array<T|undefined|null>): T[] {
  return args.filter(
      (elem): elem is T => elem !== null && typeof elem !== 'undefined');
}

export class Class {
  private comment?: string;
  private readonly children: Class[] = [];
  private readonly parents: Class[] = [];
  private readonly _props: Property[] = [];
  private readonly _enums: EnumValue[] = [];

  private aliasesBuiltin(): boolean {
    for (const parent of this.parents) {
      if (parent instanceof Builtin || parent.aliasesBuiltin()) {
        return true;
      }
    }
    return false;
  }

  isLeaf(): boolean {
    return this.children.length === 0 && !this.aliasesBuiltin();
  }

  properties() {
    return this.isLeaf() ?
        [
          new Property('@type', new StringLiteralType(toScopedName(this.item))),
          ...this._props
        ] :
        this._props;
  }

  protected baseName() {
    return toScopedName(this.item) + 'Base';
  }
  private enumName() {
    return toScopedName(this.item) + 'Enum';
  }
  private className() {
    return toScopedName(this.item);
  }

  constructor(readonly item: JsonLdGraphItem) {}
  init(classMap: ClassMap) {
    const comments = GetComments(this.item, PreferredLanguage());
    if (comments.length === 0 && IsVerbose()) {
      console.error(`Class ${this.item[LD_ID]} has no comments.`);
    } else if (comments.length > 1) {
      console.error(`Duplicate comments provided on class ${
          this.item[LD_ID]}. It will be overwritten.`);
    }
    if (comments.length > 0) {
      this.comment = comments[0];
    }

    const parents = GetSubClassOf(this.item);
    for (const parentId of parents) {
      const parentClass = classMap.get(parentId);

      if (parentClass) {
        this.parents.push(parentClass);
        parentClass.children.push(this);
      } else {
        throw new Error(
            `Couldn't find parent of ${this.item[LD_ID]}, ${parentId}`);
      }
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

  private baseNode(): TypeNode {
    // Properties part.
    const propLiteral =
        createTypeLiteralNode(this.properties().map(prop => prop.toNode()));

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

  private baseDecl(): TypeAliasDeclaration {
    const baseNode = this.baseNode();

    return createTypeAliasDeclaration(
        /*decorators=*/[], /*modifiers=*/[], this.baseName(),
        /*typeParameters=*/[], baseNode);
  }

  private nonEnumType(): TypeNode {
    const children = this.children.map(
        child =>
            createTypeReferenceNode(child.className(), /*typeArguments=*/[]));

    const childrenNode = children.length === 0 ?
        null :
        children.length === 1 ?
        children[0] :
        createParenthesizedType(createUnionTypeNode(children));

    if (childrenNode) {
      return childrenNode;
    } else {
      return createTypeReferenceNode(this.baseName(), /*typeArguments=*/[]);
    }
  }

  private totalType(): TypeNode {
    const isEnum = this._enums.length > 0;

    if (isEnum) {
      return createUnionTypeNode([
        createTypeReferenceNode(this.enumName(), []),
        createParenthesizedType(this.nonEnumType()),
      ]);
    } else {
      return this.nonEnumType();
    }
  }

  private enumDecl(): EnumDeclaration|undefined {
    if (this._enums.length === 0) return undefined;

    return createEnumDeclaration(
        /* decorators= */[],
        createModifiersFromModifierFlags(ModifierFlags.Export), this.enumName(),
        this._enums.map(e => e.toNode()));
  }

  toNode() {
    const typeValue: TypeNode = this.totalType();
    const declaration = withComments(
        this.comment,
        createTypeAliasDeclaration(
            /* decorators = */[],
            createModifiersFromModifierFlags(ModifierFlags.Export),
            this.className(),
            [],
            typeValue,
            ));

    return arrayOf<Statement>(this.enumDecl(), this.baseDecl(), declaration);
  }
}

export class Builtin extends Class {
  constructor(
      private readonly name: string, private readonly equivTo: string,
      private readonly doc: string) {
    super({
      [LD_ID]: `http://schema.org/${name}`,
      [LD_TYPES]: '',
      [LD_LABEL]: name,
      [LD_COMMENT]: doc,
    });
  }

  toNode() {
    return [
      withComments(
          this.doc,
          createTypeAliasDeclaration(
              /*decorators=*/[],
              createModifiersFromModifierFlags(ModifierFlags.Export), this.name,
              /*typeParameters=*/[],
              createTypeReferenceNode(this.equivTo, []))),
    ];
  }

  protected baseName() {
    return this.name;
  }
}

export class EnumValue {
  readonly INSTANCE = 'EnumValue';

  private comment?: string;
  constructor(private readonly item: JsonLdGraphItem) {}

  init(map: ClassMap) {
    // First, "Type" containment.
    // A Topic can have multiple types. So the triple we're adding now could
    // either be:
    // 1. An already processed well-known type (e.g. the Topic is also a Class,
    //    as well as being an enum).
    // 2. The Type of the Enum.
    //
    // e.g.: SurgicalProcedure (schema.org/SurgicalProcedure) is both a class
    //       having the "Class" type, and also an instance of the
    //       MedicalProcedureType (schema.org/MedicalProcedureType) enum.
    //       Therefore, an Enum will contain two TTypeName ObjectPredicates:
    //       one of Type=Class, and another of Type=MedicalProcedureType.
    const types = GetTypes(this.item);
    for (const type of types) {
      if (IsClassType(type) || IsDataType(type)) continue;

      const enumObject = map.get(type);
      if (!enumObject) {
        throw new Error(`Couldn't find ${type} in classes.`);
      }
      enumObject.addEnum(this);
      return true;
    }

    // Comment.
    const comments = GetComments(this.item, PreferredLanguage());
    if (comments.length === 0 && IsVerbose()) {
      console.error(`No comments found in ${this.item[LD_ID]}`);
    } else if (comments.length > 1) {
      console.error(`Duplicate comments found in ${this.item[LD_ID]}`);
    }
    this.comment = comments[0];
  }

  toNode() {
    return withComments(
        this.comment,
        createEnumMember(
            toEnumMemberName(this.item),
            createStringLiteral(this.item[LD_ID])));
  }
}

const wellKnownTypes = [
  new Builtin('Text', 'string', 'Data type: Text.'),
  new Builtin('Number', 'number', 'Data type: Number.'),
  new Builtin(
      'Time', 'string',
      'DateTime represented in string, e.g. 2017-01-04T17:10:00-05:00.'),
  new Builtin(
      'Date', 'string',
      'A date value in <a href=\"http://en.wikipedia.org/wiki/ISO_8601\">ISO 8601 date format</a>.'),
  new Builtin(
      'DateTime', 'string',
      'A combination of date and time of day in the form [-]CCYY-MM-DDThh:mm:ss[Z|(+|-)hh:mm] (see Chapter 5.4 of ISO 8601).'),
  new Builtin('Boolean', 'boolean', 'Boolean: True or False.'),
];

function IsClass(item: JsonLdGraphItem): boolean {
  const types = GetTypes(item);
  // Skip all Native Types. These are covered in wellKnownTypes.
  if (types.some(IsDataType)) return false;

  // Skip the DataType Type itself.
  if (IsDataType(item[LD_ID])) return false;

  // Skip anything that isn't a class.
  if (!types.some(IsClassType)) return false;

  return true;
}

function ForwardDeclareClasses(items: ReadonlyArray<JsonLdGraphItem>):
    ClassMap {
  const classes = new Map<string, Class>();
  for (const wk of wellKnownTypes) {
    classes.set(wk.item[LD_ID], wk);
  }
  for (const item of items) {
    if (!IsClass(item)) continue;
    classes.set(item[LD_ID], new Class(item));
  }

  if (classes.size === 0) {
    throw new Error('Expected Class topics to exist.');
  }

  return classes;
}

function BuildClasses(
    items: ReadonlyArray<JsonLdGraphItem>, classes: ClassMap) {
  for (const item of items) {
    if (!IsClass(item)) continue;
    const cls = classes.get(item[LD_ID]);

    if (!cls) {
      throw new Error(
          `Class ${item[LD_ID]} should have been forward declared.`);
    }
    cls.init(classes);
  }
}

export function ProcessClasses(items: ReadonlyArray<JsonLdGraphItem>):
    ClassMap {
  const classes = ForwardDeclareClasses(items);
  BuildClasses(items, classes);
  return classes;
}

export function FindProperties(topics: ReadonlyArray<JsonLdGraphItem>):
    ReadonlyArray<JsonLdGraphItem> {
  const properties =
      topics.filter(topic => GetTypes(topic).some(IsPropertyType));
  if (properties.length === 0) {
    throw new Error('Unexpected: Property Topics to exist.');
  }
  return properties;
}
