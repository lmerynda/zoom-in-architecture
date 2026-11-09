package shop;

@Configuration
class SecurityConfig {

	@Bean
	SecurityFilterChain chain(HttpSecurity http) throws Exception {
		return http.authorizeHttpRequests(auth -> auth
				.requestMatchers(HttpMethod.GET, "/orders", "/api/orders").permitAll()
				.anyRequest().authenticated())
			.build();
	}
}
