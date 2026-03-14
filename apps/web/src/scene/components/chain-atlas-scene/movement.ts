import { type Object3D } from "three";
import {
  AVATAR_RADIUS,
  COLLISION_EPSILON,
  COLLISION_PUSH_BIAS,
  OBSTACLE_CIRCLES,
  OBSTACLE_RECTS,
  type RectArea,
  type RotatedRectArea,
  type ZoneConfig,
  WALKABLE_CIRCLES,
  WALKABLE_RECTS,
} from "./config";

function isInsideCircle(
  x: number,
  z: number,
  area: { x: number; z: number; r: number },
) {
  const dx = x - area.x;
  const dz = z - area.z;
  return dx * dx + dz * dz <= area.r * area.r;
}

function isInsideRect(x: number, z: number, area: RectArea) {
  return Math.abs(x - area.x) <= area.hx && Math.abs(z - area.z) <= area.hz;
}

export function isWalkable(x: number, z: number) {
  return (
    WALKABLE_CIRCLES.some((area) => isInsideCircle(x, z, area)) ||
    WALKABLE_RECTS.some((area) => isInsideRect(x, z, area))
  );
}

function pushOutOfRect(x: number, z: number, rect: RotatedRectArea) {
  const rotation = rect.rotationY ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const relX = x - rect.x;
  const relZ = z - rect.z;
  const localX = relX * cos + relZ * sin;
  const localZ = -relX * sin + relZ * cos;
  const expandedHx = rect.hx + AVATAR_RADIUS + COLLISION_PUSH_BIAS;
  const expandedHz = rect.hz + AVATAR_RADIUS + COLLISION_PUSH_BIAS;

  if (Math.abs(localX) > expandedHx || Math.abs(localZ) > expandedHz) {
    return { x, z };
  }

  const penX = expandedHx - Math.abs(localX);
  const penZ = expandedHz - Math.abs(localZ);
  if (penX <= COLLISION_EPSILON && penZ <= COLLISION_EPSILON) {
    return { x, z };
  }

  let nextLocalX = localX;
  let nextLocalZ = localZ;
  if (penX < penZ) {
    nextLocalX =
      localX >= 0
        ? expandedHx + COLLISION_EPSILON
        : -expandedHx - COLLISION_EPSILON;
  } else {
    nextLocalZ =
      localZ >= 0
        ? expandedHz + COLLISION_EPSILON
        : -expandedHz - COLLISION_EPSILON;
  }

  const worldOffsetX = nextLocalX * cos - nextLocalZ * sin;
  const worldOffsetZ = nextLocalX * sin + nextLocalZ * cos;
  return { x: rect.x + worldOffsetX, z: rect.z + worldOffsetZ };
}

function pushOutOfObstacles(x: number, z: number) {
  let nextX = x;
  let nextZ = z;

  for (let pass = 0; pass < 2; pass += 1) {
    for (const obstacle of OBSTACLE_RECTS) {
      const adjusted = pushOutOfRect(nextX, nextZ, obstacle);
      nextX = adjusted.x;
      nextZ = adjusted.z;
    }

    for (const obstacle of OBSTACLE_CIRCLES) {
      const dx = nextX - obstacle.x;
      const dz = nextZ - obstacle.z;
      const minDistance = obstacle.r + AVATAR_RADIUS + COLLISION_PUSH_BIAS;
      const distanceSquared = dx * dx + dz * dz;
      const safeDistance = Math.max(minDistance - COLLISION_EPSILON, 0.0001);

      if (distanceSquared >= safeDistance * safeDistance) {
        continue;
      }

      const distance = Math.sqrt(distanceSquared);
      if (distance <= COLLISION_EPSILON) {
        nextX = obstacle.x + minDistance + COLLISION_EPSILON;
        continue;
      }
      const pushScale = (minDistance + COLLISION_EPSILON) / distance;
      nextX = obstacle.x + dx * pushScale;
      nextZ = obstacle.z + dz * pushScale;
    }
  }

  return { x: nextX, z: nextZ };
}

export function resolveMovement(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
) {
  const candidate = pushOutOfObstacles(targetX, targetZ);
  if (isWalkable(candidate.x, candidate.z)) {
    return candidate;
  }

  const xOnly = pushOutOfObstacles(targetX, currentZ);
  if (isWalkable(xOnly.x, xOnly.z)) {
    return xOnly;
  }

  const zOnly = pushOutOfObstacles(currentX, targetZ);
  if (isWalkable(zOnly.x, zOnly.z)) {
    return zOnly;
  }

  for (const factor of [0.85, 0.65, 0.45, 0.25]) {
    const blended = pushOutOfObstacles(
      currentX + (candidate.x - currentX) * factor,
      currentZ + (candidate.z - currentZ) * factor,
    );

    if (isWalkable(blended.x, blended.z)) {
      return blended;
    }
  }

  return { x: currentX, z: currentZ };
}

export function shortestAngleDelta(current: number, target: number) {
  const twoPi = Math.PI * 2;
  let delta = (target - current) % twoPi;
  if (delta > Math.PI) {
    delta -= twoPi;
  }
  if (delta < -Math.PI) {
    delta += twoPi;
  }
  return delta;
}

export function getOverlayForZone(zone?: ZoneConfig) {
  if (!zone) {
    return undefined;
  }
  if (zone.kind === "swap") {
    return "swap" as const;
  }
  if (zone.kind === "bridge") {
    return "bridge" as const;
  }
  if (zone.kind === "send") {
    return "send" as const;
  }
  return undefined;
}

export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

export function hasBlockedGroundAncestor(object: Object3D) {
  let current: Object3D | null = object;
  while (current) {
    const name = current.name.toLowerCase();
    if (name.includes("tree") || name.includes("water")) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
