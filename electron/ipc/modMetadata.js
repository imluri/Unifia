// Mod metadata and relationship utilities
const fs = require('fs');
const path = require('path');
const { modsDir } = require('../paths');

// Build a map of which mods depend on which other mods
function buildDependencyGraph(modState, packages) {
  const byName = new Map(packages.map((p) => [p.fullName, p]));
  const dependents = new Map(); // fullName -> [fullNames that depend on it]
  
  for (const [fullName, modData] of Object.entries(modState || {})) {
    const pkg = byName.get(fullName);
    if (!pkg || !pkg.latest) continue;
    
    for (const dep of pkg.latest.dependencies || []) {
      const depName = dep.split('-').slice(0, -1).join('-'); // strip version
      if (!dependents.has(depName)) dependents.set(depName, []);
      dependents.get(depName).push(fullName);
    }
  }
  
  return dependents;
}

// Get mods that depend on a specific mod
function getDependents(fullName, modState, packages) {
  const graph = buildDependencyGraph(modState, packages);
  return graph.get(fullName) || [];
}

// Detect known mod conflicts (based on package tags/categories)
function detectConflicts(fullName, modState, packages) {
  const byName = new Map(packages.map((p) => [p.fullName, p]));
  const thisMod = byName.get(fullName);
  if (!thisMod) return [];

  const conflicts = [];
  
  // Check for conflicting mods (same category mods that shouldn't coexist)
  const conflictingCategories = ['Netcode', 'Weather', 'Difficulty'];
  const thisCategories = thisMod.categories || [];
  
  for (const [otherName, otherData] of Object.entries(modState || {})) {
    if (otherName === fullName || !otherData.enabled) continue;
    
    const otherPkg = byName.get(otherName);
    if (!otherPkg) continue;
    
    const otherCategories = otherPkg.categories || [];
    for (const cat of conflictingCategories) {
      if (thisCategories.includes(cat) && otherCategories.includes(cat)) {
        conflicts.push({
          fullName: otherName,
          category: cat,
          reason: `Both provide ${cat} functionality`,
        });
      }
    }
  }
  
  return conflicts;
}

// Compute dependents for a mod (read-only, computed from packages)
function computeDependents(fullName, packages) {
  const dependents = [];
  const byName = new Map(packages.map((p) => [p.fullName, p]));
  
  for (const pkg of packages) {
    if (!pkg.latest) continue;
    for (const dep of pkg.latest.dependencies || []) {
      const depName = dep.split('-').slice(0, -1).join('-');
      if (depName === fullName && !dependents.includes(pkg.fullName)) {
        dependents.push(pkg.fullName);
      }
    }
  }
  
  return dependents;
}

module.exports = { buildDependencyGraph, getDependents, detectConflicts, computeDependents };
