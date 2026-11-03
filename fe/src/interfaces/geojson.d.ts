declare namespace GeoJSON {
  export type Position = number[]
  export type BBox = [number, number, number, number] | [number, number, number, number, number, number]
  export type GeoJsonProperties = { [name: string]: unknown } | null

  export interface Point {
    type: 'Point'
    coordinates: Position
    bbox?: BBox
  }

  export interface MultiPoint {
    type: 'MultiPoint'
    coordinates: Position[]
    bbox?: BBox
  }

  export interface LineString {
    type: 'LineString'
    coordinates: Position[]
    bbox?: BBox
  }

  export interface MultiLineString {
    type: 'MultiLineString'
    coordinates: Position[][]
    bbox?: BBox
  }

  export interface Polygon {
    type: 'Polygon'
    coordinates: Position[][]
    bbox?: BBox
  }

  export interface MultiPolygon {
    type: 'MultiPolygon'
    coordinates: Position[][][]
    bbox?: BBox
  }

  export interface GeometryCollection {
    type: 'GeometryCollection'
    geometries: Geometry[]
    bbox?: BBox
  }

  export type Geometry =
    | Point
    | MultiPoint
    | LineString
    | MultiLineString
    | Polygon
    | MultiPolygon
    | GeometryCollection

  export interface Feature<G extends Geometry | null = Geometry, P = GeoJsonProperties> {
    type: 'Feature'
    geometry: G
    id?: string | number
    properties: P
    bbox?: BBox
  }

  export interface FeatureCollection<G extends Geometry | null = Geometry, P = GeoJsonProperties> {
    type: 'FeatureCollection'
    features: Feature<G, P>[]
    bbox?: BBox
  }

  export type GeoJSON = Geometry | Feature | FeatureCollection
}

