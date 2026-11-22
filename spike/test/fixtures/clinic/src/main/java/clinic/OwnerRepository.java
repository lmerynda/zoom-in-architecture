package clinic;

interface OwnerRepository extends JpaRepository<Owner, Integer> {

	Page<Owner> findByLastName(String lastName, Pageable pageable);

}
