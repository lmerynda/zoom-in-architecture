//! The engine's entry point.
mod physics;
pub fn tick() { physics::step(); }
